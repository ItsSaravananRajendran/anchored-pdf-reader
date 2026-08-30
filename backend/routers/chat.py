"""Chat (SSE streaming) routes.

The only SSE endpoint: POST /api/session/{session_id}/chat. Streams the
MiniMax-M3 response to the client as Server-Sent Events while persisting
each message state to SQLite.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Set, Tuple

import asyncio
import base64
import json
import uuid

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from .. import db, minimax_client, pdf_ops, settings
from ..models import ChatRequest

router = APIRouter(prefix="/api", tags=["chat"])


@router.post("/chat")
async def chat(req: ChatRequest):
    """Stream a chat reply. SSE event types: token, error, done."""
    sess = db.get_session(req.session_id)
    if sess is None:
        raise HTTPException(404, "session not found")

    pdf = db.get_pdf(sess["pdf_hash"])
    if pdf is None:
        raise HTTPException(404, "pdf for session not found")

    # Resolve the anchor for this message. The first message in a session
    # must include one (the user always anchors a chat to a PDF region).
    # Follow-up messages can omit the anchor — we inherit it from the
    # most recent prior message in the same session so the chat stays
    # grounded in the same region of the PDF.
    if req.anchor is None:
        prior = db.last_message_with_anchor(req.session_id)
        if prior is None:
            raise HTTPException(400, "first message in a session requires an anchor")
        anchor_page = prior["anchor_page"]
        anchor_rect = json.loads(prior["anchor_rect"])
        anchor_rotation = prior["anchor_rotation"] or 0
    else:
        anchor_page = req.anchor.page
        anchor_rect = req.anchor.rect.model_dump()
        anchor_rotation = req.anchor.rotation

    # 1. Persist the user message immediately
    db.add_message(
        msg_id=req.message_id,
        session_id=req.session_id,
        role="user",
        text=req.text,
        anchor_page=anchor_page,
        anchor_rect=anchor_rect,
        anchor_rotation=anchor_rotation,
        status="complete",
    )

    # 2. Persist the assistant placeholder
    assistant_id = f"a-{uuid.uuid4().hex[:12]}"
    db.add_message(
        msg_id=assistant_id,
        session_id=req.session_id,
        role="assistant",
        text="",
        anchor_page=anchor_page,
        anchor_rect=anchor_rect,
        anchor_rotation=anchor_rotation,
        status="streaming",
    )

    # 3. Gather context: page text + rectangle crop
    try:
        page_text, page_image_b64 = await _prepare_context(
            pdf["path"], anchor_page, anchor_rect,
        )
    except Exception as exc:
        db.update_message_text(
            assistant_id, f"(error preparing context: {exc})",
            status="failed", error_kind="context_error",
        )
        raise HTTPException(500, f"context preparation failed: {exc}")

    # 4. Build history (last 8 turns, text only)
    history = _build_history(req.session_id, skip_ids={req.message_id, assistant_id})

    # 5. Stream
    return StreamingResponse(
        _event_stream(
            api_key=settings.MINIMAX_API_KEY,
            question=req.text,
            page_image_b64=page_image_b64,
            page_text=page_text,
            history=history,
            assistant_id=assistant_id,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---- Helpers ------------------------------------------------------

async def _prepare_context(pdf_path: str, page: int, rect: dict) -> Tuple[Optional[str], str]:
    """Returns (page_text or None, base64-encoded PNG of the rect crop)."""
    text_results = await pdf_ops.get_text_for_session(_hash_from_path(pdf_path), [page])
    page_text = text_results.get(page)

    loop = asyncio.get_event_loop()
    crop_bytes = await loop.run_in_executor(
        None, pdf_ops.render_rect_crop, pdf_path, page, rect, 0, 2.0,
    )
    return page_text, base64.b64encode(crop_bytes).decode("ascii")


def _hash_from_path(pdf_path: str) -> str:
    """Look up the pdf hash for a path. The chat router already has the pdf row in hand,
    so we pass it through differently in callers. This helper exists so the type
    signature stays clean. Returns "" if not found (caller should handle)."""
    with db.conn() as c:
        row = c.execute("SELECT hash FROM pdf WHERE path=?", (pdf_path,)).fetchone()
        return row["hash"] if row else ""


def _build_history(session_id: str, skip_ids: Set[str]) -> List[Dict]:
    rows = db.list_messages(session_id)
    filtered = [r for r in rows if r["id"] not in skip_ids]
    return [
        {"role": r["role"], "content": r["text"]}
        for r in filtered[-16:]
    ]


async def _event_stream(
    api_key: str,
    question: str,
    page_image_b64: str,
    page_text: Optional[str],
    history: List[Dict],
    assistant_id: str,
):
    accumulated: List[str] = []
    try:
        async for event in minimax_client.stream_chat(
            api_key=api_key,
            question=question,
            page_image_b64=page_image_b64,
            page_text=page_text,
            history=history,
        ):
            kind = event["type"]
            if kind == "token":
                accumulated.append(event["text"])
                yield f"event: token\ndata: {_json_escape(event['text'])}\n\n"
            elif kind == "reasoning":
                # Reasoning tokens are intentionally dropped: not shown to user,
                # not persisted. (Easy to add as a hidden UI channel later.)
                pass
            elif kind == "error":
                db.update_message_text(
                    assistant_id, "".join(accumulated) or "(no response)",
                    status="failed", error_kind="provider_error",
                )
                yield f"event: error\ndata: {_json_escape(event['message'])}\n\n"
                yield "event: done\ndata: {}\n\n"
                return
            elif kind == "done":
                db.update_message_text(
                    assistant_id, "".join(accumulated), status="complete",
                )
                yield "event: done\ndata: {}\n\n"
                return
    except asyncio.CancelledError:
        db.update_message_text(
            assistant_id, "".join(accumulated) or "(stopped)",
            status="stopped", error_kind="client_disconnect",
        )
        raise
    except Exception as exc:
        db.update_message_text(
            assistant_id, "".join(accumulated) or f"(error: {exc})",
            status="failed", error_kind="server_error",
        )
        yield f"event: error\ndata: {_json_escape(str(exc))}\n\n"
        yield "event: done\ndata: {}\n\n"


def _json_escape(value: str) -> str:
    """JSON-encode a string for embedding in an SSE `data:` field."""
    return json.dumps(value, ensure_ascii=False)