"""FastAPI app for the PDF reader + anchored AI chat."""
import asyncio
import base64
import os
import secrets
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, HttpUrl, Field

from . import db, pdf_ops, minimax_client

HERE = Path(__file__).parent
FRONTEND_DIR = HERE.parent / "frontend"
BIND_HOST = os.environ.get("BIND_HOST", "127.0.0.1")
BIND_PORT = int(os.environ.get("BIND_PORT", "8910"))

app = FastAPI(title="PDF Reader + Anchored AI Chat", version="0.1.0")


@app.on_event("startup")
async def _startup() -> None:
    db.init_db()


# ---- Health ----------------------------------------------------------

@app.get("/healthz")
async def healthz():
    try:
        with db.conn() as c:
            c.execute("SELECT 1").fetchone()
        return {"ok": True}
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


# ---- PDF load --------------------------------------------------------

class LoadRequest(BaseModel):
    url: HttpUrl


@app.post("/api/pdf/load")
async def pdf_load(req: LoadRequest):
    url = str(req.url)
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "only http:// and https:// URLs are accepted")
    # Pre-download check: same URL already loaded? Return its hash without re-downloading.
    with db.conn() as c:
        row = c.execute("SELECT hash, page_count, title FROM pdf WHERE url=?", (url,)).fetchone()
    if row and row["page_count"]:
        return {
            "pdf_hash": row["hash"],
            "page_count": row["page_count"],
            "title": row["title"],
            "cached": True,
        }
    try:
        digest, nbytes, path = await pdf_ops.download_pdf(url)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"download failed: {e}")

    # If already known (different URL, same bytes), reuse the existing record.
    existing = db.get_pdf(digest)
    if existing and existing["page_count"]:
        return {
            "pdf_hash": digest,
            "page_count": existing["page_count"],
            "title": existing["title"],
            "cached": True,
        }

    # Otherwise inspect on a thread (page count + title)
    def _inspect():
        try:
            pc = pdf_ops.page_count(path)
        except Exception:
            pc = None
        title = None
        try:
            import pypdf
            reader = pypdf.PdfReader(path)
            md = reader.metadata or {}
            title = (md.get("/Title") or "").strip() or None
        except Exception:
            pass
        return pc, title

    loop = asyncio.get_event_loop()
    pc, title = await loop.run_in_executor(None, _inspect)
    db.upsert_pdf(digest, url, nbytes, path, pc, title)
    return {"pdf_hash": digest, "page_count": pc, "title": title, "cached": False}


@app.get("/api/pdf/{pdf_hash}/page/{n}.png")
async def pdf_page_png(pdf_hash: str, n: int):
    pdf = db.get_pdf(pdf_hash)
    if pdf is None:
        raise HTTPException(404, "pdf not found")
    if n < 1 or (pdf["page_count"] and n > pdf["page_count"]):
        raise HTTPException(400, "page out of range")
    try:
        png_bytes = await asyncio.get_event_loop().run_in_executor(
            None, pdf_ops.render_page_png, pdf["path"], n, 2.0
        )
    except Exception as e:
        raise HTTPException(500, f"render failed: {e}")
    return StreamingResponse(iter([png_bytes]), media_type="image/png",
                             headers={"Cache-Control": "public, max-age=3600"})


@app.get("/api/pdf/{pdf_hash}/file")
async def pdf_file(pdf_hash: str, request: Request):
    """Serve the raw PDF bytes with HTTP Range support so PDF.js can render it."""
    pdf = db.get_pdf(pdf_hash)
    if pdf is None:
        raise HTTPException(404, "pdf not found")
    p = Path(pdf["path"])
    if not p.exists():
        raise HTTPException(404, "pdf bytes missing on disk")
    file_size = p.stat().st_size
    range_header = request.headers.get("range") or request.headers.get("Range")
    if range_header:
        # Parse "bytes=start-end"
        try:
            units, _, rng = range_header.partition("=")
            if units.strip() != "bytes":
                raise ValueError
            start_s, _, end_s = rng.partition("-")
            start = int(start_s) if start_s else 0
            end = int(end_s) if end_s else file_size - 1
            end = min(end, file_size - 1)
            length = end - start + 1
        except Exception:
            raise HTTPException(416, "invalid range")
        def _iter():
            with p.open("rb") as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(64 * 1024, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk
        return StreamingResponse(
            _iter(),
            status_code=206,
            media_type="application/pdf",
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(length),
                "Cache-Control": "public, max-age=3600",
            },
        )
    return FileResponse(p, media_type="application/pdf",
                        headers={"Accept-Ranges": "bytes",
                                 "Cache-Control": "public, max-age=3600"})


# ---- Text extraction -------------------------------------------------

class TextRequest(BaseModel):
    pages: list[int] = Field(..., min_length=1, max_length=10)


@app.post("/api/pdf/{pdf_hash}/text")
async def pdf_text(pdf_hash: str, req: TextRequest):
    pdf = db.get_pdf(pdf_hash)
    if pdf is None:
        raise HTTPException(404, "pdf not found")
    results = await pdf_ops.get_text_for_session(pdf_hash, req.pages)
    return {"results": {str(p): (t if t is not None else "") for p, t in results.items()},
            "has_text": {str(p): (t is not None and t != "") for p, t in results.items()}}


# ---- Library listing ------------------------------------------------

@app.get("/api/pdfs")
async def pdfs_list():
    rows = db.list_pdfs()
    items = []
    for r in rows:
        items.append({
            "pdf_hash": r["hash"],
            "url": r["url"],
            "title": r["title"],
            "page_count": r["page_count"],
            "bytes": r["bytes"],
            "first_loaded_at": r["created_at"],
            "last_session_at": r["last_session_at"],
            "session_count": r["session_count"],
            "message_count": r["message_count"],
        })
    return {"items": items}


@app.get("/api/pdf/{pdf_hash}/anchors")
async def pdf_anchors(pdf_hash: str):
    pdf = db.get_pdf(pdf_hash)
    if pdf is None:
        raise HTTPException(404, "pdf not found")
    return {"pdf_hash": pdf_hash, "anchors": db.list_anchors_for_pdf(pdf_hash)}


@app.get("/api/pdf/{pdf_hash}/info")
async def pdf_info(pdf_hash: str):
    """Lightweight summary for the library list — no anchors, no text."""
    pdf = db.get_pdf(pdf_hash)
    if pdf is None:
        raise HTTPException(404, "pdf not found")
    return {
        "pdf_hash": pdf["hash"],
        "url": pdf["url"],
        "title": pdf["title"],
        "page_count": pdf["page_count"],
        "bytes": pdf["bytes"],
    }


# ---- Sessions --------------------------------------------------------

class NewSessionRequest(BaseModel):
    pdf_hash: str


@app.post("/api/session/new")
async def session_new(req: NewSessionRequest):
    pdf = db.get_pdf(req.pdf_hash)
    if pdf is None:
        raise HTTPException(404, "pdf not found")
    sid = secrets.token_urlsafe(16)
    db.create_session(sid, req.pdf_hash)
    return {"session_id": sid}


@app.get("/api/session/{session_id}/messages")
async def session_messages(session_id: str):
    sess = db.get_session(session_id)
    if sess is None:
        raise HTTPException(404, "session not found")
    rows = db.list_messages(session_id)
    msgs = []
    for r in rows:
        import json as _json
        anchor_rect = _json.loads(r["anchor_rect"]) if r["anchor_rect"] else None
        msgs.append({
            "id": r["id"],
            "role": r["role"],
            "text": r["text"],
            "anchor_page": r["anchor_page"],
            "anchor_rect": anchor_rect,
            "anchor_rotation": r["anchor_rotation"],
            "status": r["status"],
            "error_kind": r["error_kind"],
            "created_at": r["created_at"],
        })
    return {"session_id": session_id, "pdf_hash": sess["pdf_hash"], "messages": msgs}


@app.delete("/api/session/{session_id}")
async def session_delete(session_id: str):
    db.delete_session(session_id)
    return {"ok": True}


@app.delete("/api/anchor/{message_id}")
async def anchor_delete(message_id: str):
    """Delete an anchor pair (the user question and its assistant reply)
    identified by the given message id. The frontend can call this with either
    the user or assistant message id — both will be removed."""
    n = db.delete_anchor_for_message(message_id)
    if n == 0:
        raise HTTPException(404, "anchor not found")
    return {"ok": True, "deleted": n}


# ---- Chat (streaming) ------------------------------------------------

class AnchorModel(BaseModel):
    page: int
    rect: dict
    rotation: int = 0


class ChatRequest(BaseModel):
    session_id: str
    message_id: str
    text: str = Field(..., min_length=1)
    anchor: AnchorModel


@app.post("/api/chat")
async def chat(req: ChatRequest):
    sess = db.get_session(req.session_id)
    if sess is None:
        raise HTTPException(404, "session not found")

    api_key = os.environ.get("MINIMAX_API_KEY")
    if not api_key:
        raise HTTPException(500, "MINIMAX_API_KEY not configured on server")

    pdf = db.get_pdf(sess["pdf_hash"])
    if pdf is None:
        raise HTTPException(404, "pdf for session not found")

    # 1. Persist user message immediately
    db.add_message(
        msg_id=req.message_id,
        session_id=req.session_id,
        role="user",
        text=req.text,
        anchor_page=req.anchor.page,
        anchor_rect=req.anchor.rect,
        anchor_rotation=req.anchor.rotation,
        status="complete",
    )

    # 2. Persist assistant placeholder
    assistant_id = f"a-{uuid.uuid4().hex[:12]}"
    db.add_message(
        msg_id=assistant_id,
        session_id=req.session_id,
        role="assistant",
        text="",
        anchor_page=req.anchor.page,
        anchor_rect=req.anchor.rect,
        anchor_rotation=req.anchor.rotation,
        status="streaming",
    )

    # 3. Gather context: page text + rectangle crop
    async def _setup():
        # Page text
        text_results = await pdf_ops.get_text_for_session(sess["pdf_hash"], [req.anchor.page])
        page_text = text_results.get(req.anchor.page)

        # Rectangle crop (rendered at 2x DPI)
        loop = asyncio.get_event_loop()
        crop_bytes = await loop.run_in_executor(
            None, pdf_ops.render_rect_crop,
            pdf["path"], req.anchor.page, req.anchor.rect, req.anchor.rotation, 2.0,
        )
        return page_text, base64.b64encode(crop_bytes).decode("ascii")

    try:
        page_text, page_image_b64 = await _setup()
    except Exception as e:
        db.update_message_text(assistant_id, f"(error preparing context: {e})",
                               status="failed", error_kind="context_error")
        raise HTTPException(500, f"context preparation failed: {e}")

    # 4. Build history (last 8 turns, text only)
    rows = db.list_messages(req.session_id)
    # rows include the user message we just added and the empty assistant placeholder — skip them
    history_rows = [r for r in rows if r["id"] not in (req.message_id, assistant_id)]
    history = [{"role": r["role"], "content": r["text"]} for r in history_rows[-16:]]

    # 5. Stream
    async def event_stream():
        accumulated = []
        try:
            async for event in minimax_client.stream_chat(
                api_key=api_key,
                question=req.text,
                page_image_b64=page_image_b64,
                page_text=page_text,
                history=history,
            ):
                if event["type"] == "token":
                    accumulated.append(event["text"])
                    yield f"event: token\ndata: {json_escape(event['text'])}\n\n"
                elif event["type"] == "reasoning":
                    # Reasoning tokens are intentionally dropped: not shown to user,
                    # not persisted. (Easy to add as a hidden UI channel later.)
                    pass
                elif event["type"] == "error":
                    db.update_message_text(assistant_id, "".join(accumulated) or "(no response)",
                                           status="failed", error_kind="provider_error")
                    yield f"event: error\ndata: {json_escape(event['message'])}\n\n"
                    yield "event: done\ndata: {}\n\n"
                    return
                elif event["type"] == "done":
                    db.update_message_text(assistant_id, "".join(accumulated),
                                           status="complete")
                    yield "event: done\ndata: {}\n\n"
                    return
        except asyncio.CancelledError:
            db.update_message_text(assistant_id, "".join(accumulated) or "(stopped)",
                                   status="stopped", error_kind="client_disconnect")
            raise
        except Exception as e:
            db.update_message_text(assistant_id, "".join(accumulated) or f"(error: {e})",
                                   status="failed", error_kind="server_error")
            yield f"event: error\ndata: {json_escape(str(e))}\n\n"
            yield "event: done\ndata: {}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def json_escape(s: str) -> str:
    import json
    return json.dumps(s, ensure_ascii=False)


# ---- Static frontend --------------------------------------------------

if FRONTEND_DIR.exists():
    from starlette.staticfiles import StaticFiles as _SF
    import starlette.staticfiles as _ssf

    class _NoCacheStatic(_SF):
        async def get_response(self, path, scope):
            resp = await super().get_response(path, scope)
            if hasattr(resp, "headers"):
                resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
                resp.headers["Pragma"] = "no-cache"
                resp.headers["Expires"] = "0"
            return resp

    app.mount("/static", _NoCacheStatic(directory=FRONTEND_DIR), name="static")


@app.get("/")
async def index():
    idx = FRONTEND_DIR / "index.html"
    if not idx.exists():
        raise HTTPException(404, "frontend not built")
    return FileResponse(idx)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app:app", host=BIND_HOST, port=BIND_PORT, reload=False)
