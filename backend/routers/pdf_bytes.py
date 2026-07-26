"""PDF bytes routes — serving the PDF file and rendered pages.

PDF.js fetches these. Range support is critical: PDF.js uses byte ranges
to seek through the file without downloading it whole.

Split out from pdfs.py to keep each router file under 250 lines.
"""
from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse

from .. import db, pdf_ops
from ..models import RectCropRequest

router = APIRouter(prefix="/api", tags=["pdf-bytes"])


@router.get("/pdf/{pdf_hash}/file")
async def pdf_file(pdf_hash: str, request: Request):
    """Serve the raw PDF bytes with HTTP Range support so PDF.js can render it."""
    pdf = db.get_pdf(pdf_hash)
    if pdf is None:
        raise HTTPException(404, "pdf not found")
    path = Path(pdf["path"])
    if not path.exists():
        raise HTTPException(404, "pdf bytes missing on disk")
    file_size = path.stat().st_size

    range_header = request.headers.get("range") or request.headers.get("Range")
    if range_header:
        try:
            start, end, length = _parse_range(range_header, file_size)
        except ValueError:
            raise HTTPException(416, "invalid range")

        def _iter():
            with path.open("rb") as f:
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
    return FileResponse(
        path,
        media_type="application/pdf",
        headers={
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=3600",
        },
    )


@router.get("/pdf/{pdf_hash}/page/{page}.png")
async def pdf_page_png(pdf_hash: str, page: int):
    pdf = db.get_pdf(pdf_hash)
    if pdf is None:
        raise HTTPException(404, "pdf not found")
    if page < 1 or (pdf["page_count"] and page > pdf["page_count"]):
        raise HTTPException(400, "page out of range")
    try:
        png_bytes = await asyncio.get_event_loop().run_in_executor(
            None, pdf_ops.render_page_png, pdf["path"], page, 2.0,
        )
    except Exception as exc:
        raise HTTPException(500, f"render failed: {exc}")
    return StreamingResponse(
        iter([png_bytes]),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.post("/pdf/{pdf_hash}/rect.png")
async def pdf_rect_crop(pdf_hash: str, req: RectCropRequest):
    pdf = db.get_pdf(pdf_hash)
    if pdf is None:
        raise HTTPException(404, "pdf not found")
    if req.page < 1 or (pdf["page_count"] and req.page > pdf["page_count"]):
        raise HTTPException(400, "page out of range")
    try:
        crop_bytes = await asyncio.get_event_loop().run_in_executor(
            None,
            pdf_ops.render_rect_crop,
            pdf["path"], req.page, req.rect.model_dump(), 0, req.scale,
        )
    except Exception as exc:
        raise HTTPException(500, f"crop failed: {exc}")
    return StreamingResponse(
        iter([crop_bytes]),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=3600"},
    )


def _parse_range(range_header: str, file_size: int) -> tuple[int, int, int]:
    """Parse 'bytes=start-end'. Returns (start, end, length). Raises ValueError on garbage."""
    units, _, rng = range_header.partition("=")
    if units.strip() != "bytes":
        raise ValueError("unsupported unit")
    start_s, _, end_s = rng.partition("-")
    start = int(start_s) if start_s else 0
    end = int(end_s) if end_s else file_size - 1
    end = min(end, file_size - 1)
    length = end - start + 1
    return start, end, length