"""FastAPI composition root.

This module does three things:
  1. Create the FastAPI app and register a startup hook
  2. Mount the no-cache static directory and the index route
  3. Include every resource router

All the actual logic lives in routers/* and services (db, pdf_ops, minimax_client).
"""
from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

from . import db, settings
from .routers import anchors, chat, pdf_bytes, pdfs, sessions
from .static import NoCacheStatic

app = FastAPI(title="PDF Reader + Anchored AI Chat", version="1.0.0")


@app.on_event("startup")
async def _startup() -> None:
    db.init_db()


# ---- Routers ----------------------------------------------------------

app.include_router(pdfs.health_router)
app.include_router(pdfs.router)
app.include_router(pdf_bytes.router)
app.include_router(sessions.router)
app.include_router(chat.router)
app.include_router(anchors.router)


# ---- Static frontend --------------------------------------------------

if settings.FRONTEND_DIR.exists():
    app.mount(
        "/static",
        NoCacheStatic(directory=str(settings.FRONTEND_DIR)),
        name="static",
    )


@app.get("/")
async def index():
    index_path = settings.FRONTEND_DIR / "index.html"
    if not index_path.exists():
        raise HTTPException(404, "frontend not built")
    return FileResponse(index_path)


# ---- Dev entrypoint ---------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.app:app",
        host=settings.BIND_HOST,
        port=settings.BIND_PORT,
        reload=False,
    )