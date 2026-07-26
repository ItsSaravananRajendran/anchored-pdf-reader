"""PDF download, hashing, page-text extraction, and rectangle crop rendering."""
import asyncio
import hashlib
import io
from pathlib import Path
from typing import Optional
import httpx
import pdfplumber
import pypdfium2 as pdfium
from PIL import Image

from . import db_repos

DATA_DIR = Path(__file__).parent.parent / "data"
PDFS_DIR = DATA_DIR / "pdfs"
MAX_BYTES = 50 * 1024 * 1024  # 50 MB
DOWNLOAD_TIMEOUT = 60.0


def _pdf_path(hash_: str) -> Path:
    PDFS_DIR.mkdir(parents=True, exist_ok=True)
    return PDFS_DIR / hash_[:2] / hash_


async def download_pdf(url: str) -> tuple[str, int, str]:
    """Download a PDF, stream-hash, store on disk. Returns (hash, bytes, path)."""
    async with httpx.AsyncClient(follow_redirects=True, timeout=DOWNLOAD_TIMEOUT) as client:
        async with client.stream("GET", url) as r:
            r.raise_for_status()
            # Reject if not PDF (best-effort; some servers send wrong content-type)
            ct = r.headers.get("content-type", "").lower()
            if ct and "pdf" not in ct and "octet-stream" not in ct:
                raise ValueError(f"Server returned content-type '{ct}', expected PDF")

            hasher = hashlib.sha256()
            buf = io.BytesIO()
            total = 0
            async for chunk in r.aiter_bytes(64 * 1024):
                total += len(chunk)
                if total > MAX_BYTES:
                    raise ValueError(f"PDF exceeds {MAX_BYTES // (1024 * 1024)} MB limit")
                hasher.update(chunk)
                buf.write(chunk)

            digest = hasher.hexdigest()
            path = _pdf_path(digest)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(buf.getvalue())
            return digest, total, str(path)


def _open(path: str):
    return pdfium.PdfDocument(path)


def page_count(path: str) -> int:
    return len(_open(path))


def extract_page_text(path: str, page: int):
    """Returns (text or None, has_text). Runs synchronously — call from a thread."""
    try:
        with pdfplumber.open(path) as pdf:
            if page < 1 or page > len(pdf.pages):
                return None, False
            text = pdf.pages[page - 1].extract_text() or ""
            text = text.strip()
            return (text if text else None), bool(text)
    except Exception:
        return None, False


def render_page_png(path: str, page: int, scale: float = 2.0) -> bytes:
    """Render the whole page N as PNG bytes."""
    pdf = _open(path)
    if page < 1 or page > len(pdf):
        raise ValueError(f"page out of range: {page}")
    pil = pdf[page - 1].render(scale=scale).to_pil()
    buf = io.BytesIO()
    pil.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def render_rect_crop(path: str, page: int, rect: dict, rotation: int = 0, scale: float = 2.0) -> bytes:
    """Render the rectangle (in normalized 0..1 page coords) as a PNG crop.

    rect = {x, y, w, h} where (0,0) is top-left, units are fractions of page width/height.
    rotation is the page rotation index (0/90/180/270) at selection time.
    """
    pdf = _open(path)
    if page < 1 or page > len(pdf):
        raise ValueError(f"page out of range: {page}")
    pil_image = pdf[page - 1].render(scale=scale).to_pil()
    pw, ph = pil_image.size
    # Normalize: rect is in unrotated page space. pypdfium2 already applies rotation,
    # so we just clip directly against the rendered image.
    x0 = max(0, int(rect["x"] * pw))
    y0 = max(0, int(rect["y"] * ph))
    x1 = min(pw, int((rect["x"] + rect["w"]) * pw))
    y1 = min(ph, int((rect["y"] + rect["h"]) * ph))
    if x1 <= x0 or y1 <= y0:
        raise ValueError("empty rectangle after clipping")
    crop = pil_image.crop((x0, y0, x1, y1))
    buf = io.BytesIO()
    crop.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


async def get_text_for_session(pdf_hash, pages):
    """Cache-aware text extraction. Returns {page: text_or_None}."""
    results = {}
    to_extract = []

    for p in pages:
        cached_text, has_text = db_repos.get_page_text(pdf_hash, p)
        if has_text is False and cached_text is None and cached_text != "":
            # Two cases:
            #   (a) row missing entirely (cached_text is None, has_text is False) -> extract
            #   (b) row cached as image-only (cached_text is None, has_text is False too) -> skip
            # We can't distinguish (a) from (b) on a None hit, so always re-extract on missing.
            # The cheaper signal: check whether the row exists at all.
            row_exists = db_repos._page_text_exists(pdf_hash, p)
            if not row_exists:
                to_extract.append(p)
                results[p] = None
            else:
                results[p] = None  # image-only, cached
        else:
            results[p] = cached_text

    if to_extract:
        pdf = db_repos.get_pdf(pdf_hash)
        if pdf is not None:
            def _do_extract(page):
                return page, *extract_page_text(pdf["path"], page)

            loop = asyncio.get_event_loop()
            tasks = [loop.run_in_executor(None, _do_extract, p) for p in to_extract]
            for fut in asyncio.as_completed(tasks):
                page, text, has_text = await fut
                db_repos.set_page_text(pdf_hash, page, text, has_text)
                results[page] = text

    return results
