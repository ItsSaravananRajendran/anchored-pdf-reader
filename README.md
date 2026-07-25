# PDF Reader — Anchored AI Chat

Self-hosted PDF reader where every chat question carries a rectangle anchor from the page.

## Quick start

```bash
cd ~/projects/pdf-reader
source .venv/bin/activate
# BIND_HOST and BIND_PORT default to 127.0.0.1:8910. Override via env if needed.
# MINIMAX_API_KEY must be set in the calling shell.
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8910
```

Then open http://127.0.0.1:8910 in a browser, paste a PDF URL, draw a rectangle, ask a question.

## Verified end-to-end

Smoke-tested 2026-07-25 with `https://arxiv.org/pdf/1706.03762.pdf` (Attention Is All You Need):
- PDF download: 2.2 MB, 15 pages, hash + dedup ✓
- Page-text extraction: 2580 chars from page 1 ✓
- Page PNG render: 343 KB ✓
- PDF.js file serving with HTTP Range: 206 + Content-Range ✓
- Chat streaming: 6.9 s for full response, M3 cited the right title and 8 authors ✓
- Persistence: session + 2 messages + anchors + rects stored in SQLite ✓

## Stack

- Backend: FastAPI + SQLite
- Frontend: vanilla JS + PDF.js (no build step)
- LLM: MiniMax-M3 via OpenAI-compatible `/v1/chat/completions`
- PDF processing: pdfplumber (text), pypdfium2 (rendering crops), pypdf (validation)

## Layout

```
backend/
  app.py              # FastAPI app
  db.py               # SQLite schema + helpers
  pdf_ops.py          # download, hash, page text, render crop
  minimax_client.py   # streaming multimodal chat
frontend/
  index.html
  app.js
  styles.css
data/
  app.db              # SQLite
  pdfs/<hash[:2]>/<hash>.pdf
```

## Spec

See https://100.86.17.65:8080/preview?path=reports/pdf-reader-spec-2026-07-25/index.html

## Endpoints

- `GET /` — frontend
- `GET /healthz` — health check
- `POST /api/pdf/load` — `{url}` → `{pdf_hash, page_count, title}` (downloads + caches)
- `GET /api/pdf/{hash}/file` — raw PDF bytes with HTTP Range support (PDF.js fetches this)
- `GET /api/pdf/{hash}/page/{n}.png` — render page N as PNG (for image-only fallback / thumbnails)
- `POST /api/pdf/{hash}/text` — `{pages:[1,2,3]}` → `{results:{1:"...",2:"...",...}, has_text}`
- `POST /api/session/new` — `{pdf_hash}` → `{session_id}`
- `GET /api/session/{id}/messages` — load chat history (for refresh restore)
- `DELETE /api/session/{id}` — clear a session
- `POST /api/chat` — `{session_id, message_id, text, anchor:{page,rect,rotation}}` → SSE stream of tokens
