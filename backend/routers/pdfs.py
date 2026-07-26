"""PDF metadata + library routes.

Handles: load (download or fetch cached), library listing, info, text
extraction. The byte-serving endpoints (file/page/rect) live in pdf_bytes.py.
"""
from __future__ import annotations

from typing import Optional, Tuple

import asyncio

from fastapi import APIRouter, HTTPException

from .. import db, pdf_ops
from ..models import LoadRequest, TextRequest

router = APIRouter(prefix="/api", tags=["pdf"])


# ---- Library listing ----------------------------------------------

@router.get("/pdfs")
async def list_pdfs_endpoint():
    rows = db.list_pdfs()
    return {
        "items": [
            {
                "pdf_hash": r["hash"],
                "url": r["url"],
                "title": r["title"],
                "page_count": r["page_count"],
                "bytes": r["bytes"],
                "first_loaded_at": r["created_at"],
                "last_session_at": r["last_session_at"],
                "session_count": r["session_count"],
                "message_count": r["message_count"],
            }
            for r in rows
        ]
    }


# ---- Single PDF info / load / text --------------------------------

@router.post("/pdf/load")
async def pdf_load(req: LoadRequest):
    url = str(req.url)
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "only http:// and https:// URLs are accepted")

    # Pre-download check: same URL already loaded? Return its hash without re-downloading.
    with db.conn() as c:
        row = c.execute(
            "SELECT hash, page_count, title FROM pdf WHERE url=?",
            (url,),
        ).fetchone()
    if row and row["page_count"]:
        return {
            "pdf_hash": row["hash"],
            "page_count": row["page_count"],
            "title": row["title"],
            "cached": True,
        }

    try:
        digest, nbytes, path = await pdf_ops.download_pdf(url)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(502, f"download failed: {exc}")

    existing = db.get_pdf(digest)
    if existing and existing["page_count"]:
        return {
            "pdf_hash": digest,
            "page_count": existing["page_count"],
            "title": existing["title"],
            "cached": True,
        }

    page_count, title = await _inspect_pdf(path)
    db.upsert_pdf(digest, url, nbytes, path, page_count, title)
    return {"pdf_hash": digest, "page_count": page_count, "title": title, "cached": False}


@router.get("/pdf/{pdf_hash}/info")
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


@router.post("/pdf/{pdf_hash}/text")
async def pdf_text(pdf_hash: str, req: TextRequest):
    pdf = db.get_pdf(pdf_hash)
    if pdf is None:
        raise HTTPException(404, "pdf not found")
    results = await pdf_ops.get_text_for_session(pdf_hash, req.pages)
    return {
        "results": {str(p): (t if t is not None else "") for p, t in results.items()},
        "has_text": {str(p): (t is not None and t != "") for p, t in results.items()},
    }


@router.get("/pdf/{pdf_hash}/anchors")
async def pdf_anchors(pdf_hash: str):
    pdf = db.get_pdf(pdf_hash)
    if pdf is None:
        raise HTTPException(404, "pdf not found")
    return {"pdf_hash": pdf_hash, "anchors": db.list_anchors_for_pdf(pdf_hash)}


# ---- Health (no-router-fits bucket) -------------------------------

health_router = APIRouter(tags=["health"])


@health_router.get("/healthz")
async def healthz():
    try:
        with db.conn() as c:
            c.execute("SELECT 1").fetchone()
        return {"ok": True}
    except Exception as exc:
        from fastapi.responses import JSONResponse
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=500)


# ---- Helpers ------------------------------------------------------

async def _inspect_pdf(path: str) -> Tuple[Optional[int], Optional[str]]:
    """Get page count and title off the main thread. Returns (page_count, title)."""
    def _work():
        try:
            pc = pdf_ops.page_count(path)
        except Exception:
            pc = None
        title = None
        try:
            import pypdf
            reader = pypdf.PdfReader(path)
            metadata = reader.metadata or {}
            raw_title = metadata.get("/Title") or ""
            title = raw_title.strip() or None
        except Exception:
            pass
        return pc, title

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _work)