"""Session routes.

Handles: create a new chat session for a given PDF, list messages in a
session, delete a session, delete an anchor (and its paired message).
"""
from __future__ import annotations

import json
import secrets

from fastapi import APIRouter, HTTPException

from .. import db
from ..models import NewSessionRequest

router = APIRouter(prefix="/api", tags=["session"])


@router.post("/session/new")
async def session_new(req: NewSessionRequest):
    pdf = db.get_pdf(req.pdf_hash)
    if pdf is None:
        raise HTTPException(404, "pdf not found")
    sid = secrets.token_urlsafe(16)
    db.create_session(sid, req.pdf_hash)
    return {"session_id": sid}


@router.get("/session/{session_id}")
async def session_info(session_id: str):
    """Lightweight session info (no message body)."""
    sess = db.get_session(session_id)
    if sess is None:
        raise HTTPException(404, "session not found")
    return {
        "session_id": sess["id"],
        "pdf_hash": sess["pdf_hash"],
        "created_at": sess["created_at"],
    }


@router.get("/session/{session_id}/messages")
async def session_messages(session_id: str):
    sess = db.get_session(session_id)
    if sess is None:
        raise HTTPException(404, "session not found")
    rows = db.list_messages(session_id)
    return {
        "session_id": session_id,
        "pdf_hash": sess["pdf_hash"],
        "messages": [
            {
                "id": r["id"],
                "role": r["role"],
                "text": r["text"],
                "anchor_page": r["anchor_page"],
                "anchor_rect": json.loads(r["anchor_rect"]) if r["anchor_rect"] else None,
                "anchor_rotation": r["anchor_rotation"],
                "status": r["status"],
                "error_kind": r["error_kind"],
                "created_at": r["created_at"],
            }
            for r in rows
        ],
    }


@router.delete("/session/{session_id}")
async def session_delete(session_id: str):
    db.delete_session(session_id)
    return {"ok": True}