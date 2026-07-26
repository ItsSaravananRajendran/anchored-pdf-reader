# Anchored PDF Reader

A self-hosted web app that lets you load a PDF, drag-rectangle any region on
a page, and ask an AI question about that exact spot. Every question and
answer is stored with its (page, normalized rectangle) so you can click back
to the spot from the chat history.

## Features

- **Load a PDF from a URL** — first load downloads + caches, subsequent loads
  of the same URL are instant.
- **Continuous-scroll reader** — all pages stacked vertically, smooth page
  navigation.
- **Per-page zoom** (50/75/100/125/150/200% + fit-width).
- **Drag to resize the chat panel** (240–800px).
- **Drag-rectangle to set an anchor** on any page.
- **Library** — open any cached PDF by title without re-downloading.
- **Anchors-in-this-book sidebar** — every rectangle you've ever asked
  about in the current PDF. Click → load that conversation. × → delete.
- **Time-machine mode** — click an old anchor to see the chat that produced
  it.
- **Markdown + math (KaTeX)** in assistant replies.
- **Virtual rendering** — at most ~11 pages in memory at any time. 500-page
  books stay snappy.
- **Persistent preferences** (zoom + chat width) via localStorage.

## Stack

- **Backend:** FastAPI + SQLite + `pypdfium2` + `pdfplumber` + `httpx`.
- **Frontend:** React 18 + Vite + vanilla CSS. PDF.js from CDN.
- **LLM:** [MiniMax](https://api.minimax.io) M3 (OpenAI-compatible streaming).
  Reasoning tokens are stripped from the output stream.

## Project layout

See `ARCHITECTURE.md` for the full breakdown.

```
backend/                    FastAPI app (Python)
frontend/                   React app (JavaScript)
├── index.html               Entry HTML
├── styles/                  Design tokens + reset + layout
├── src/                     Source (≤250 lines per file)
│   ├── main.jsx
│   ├── App.jsx              Top-level wiring
│   ├── state/               useReducer + Context
│   ├── events.js            Pub/sub for cross-feature flows
│   ├── api/                 fetch + SSE
│   ├── lib/                 Pure utilities
│   ├── hooks/               Custom hooks
│   └── components/          UI components
└── dist/                    Built bundle (gitignored)
tests/                       pytest (HTTP-level + browser)
data/                        SQLite + cached PDFs (gitignored)
```

## Development setup

You'll need Python 3.9+, Node 20+, and a MiniMax API key.

```bash
git clone https://github.com/ItsSaravananRajendran/anchored-pdf-reader.git
cd anchored-pdf-reader

# Backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[test]"

# Frontend
npm install

# Two terminals:
# 1. Backend (port 8910)
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8910 --reload

# 2. Frontend dev server (port 5173, proxies /api to 8910)
npm run dev

# 3. (Optional) Build the production bundle and serve via the backend:
npm run build
```

Open http://127.0.0.1:5173 in dev, or http://127.0.0.1:8910 against the built bundle.

## Environment

Copy `.env.example` to `.env` and fill in `MINIMAX_API_KEY`. See `backend/settings.py`
for all available options.

## Tests

```bash
# HTTP-level (fast, no browser)
python -m pytest tests/

# Browser-level (Playwright, slow)
python -m pytest tests/ -m browser

# All
python -m pytest tests/ -m "not browser" && python -m pytest tests/ -m browser
```

## Security

See `SECURITY.md` — this is a single-user app with no auth. Run it on a
trusted network only.

## License

MIT. See `LICENSE`.