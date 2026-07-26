"""Anchor routes.

A single endpoint: delete an anchor pair (the user question + its assistant
reply) by either member's message id.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import db

router = APIRouter(prefix="/api", tags=["anchor"])


@router.delete("/anchor/{message_id}")
async def anchor_delete(message_id: str):
    """Delete an anchor pair (user + assistant) by either member's message id.
    Identifies the pair by shared session_id + (page, rect, rotation)."""
    deleted = db.delete_anchor_for_message(message_id)
    if deleted == 0:
        raise HTTPException(404, "anchor not found")
    return {"ok": True, "deleted": deleted}