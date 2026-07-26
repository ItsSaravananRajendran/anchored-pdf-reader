# Contributing

Thanks for your interest in contributing! This project is a self-hosted PDF
reader with anchored AI chat. The codebase is small and we keep it focused.

## Development setup

You'll need:

- Python 3.9+
- Node.js 20+
- A MiniMax API key (set as `MINIMAX_API_KEY`)

```bash
git clone https://github.com/ItsSaravananRajendran/anchored-pdf-reader.git
cd anchored-pdf-reader

# Backend
python -m venv .venv
source .venv/bin/activate
pip install -e ".[test]"

# Frontend
npm install

# Run dev (two terminals)
# Terminal 1: backend (port 8910)
source .venv/bin/activate
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8910 --reload

# Terminal 2: frontend dev server with hot reload (port 5173, proxies /api to 8910)
npm run dev
```

Open http://127.0.0.1:5173 in your browser.

## Tests

```bash
# HTTP-level tests (fast, no browser)
python -m pytest tests/

# Browser-level tests (Playwright)
python -m pytest tests/ -m browser
```

The `tests/conftest.py` spawns a live uvicorn on a free port with an isolated
`DATA_DIR`, so tests never touch your real database or PDF cache.

## Code style

- **All source files ≤ 250 lines.** Use extraction (hooks, sub-components) to
  split larger concerns.
- **Backend:** Pydantic models for request/response bodies; SQL via the
  `db_repos` helpers; settings via `backend/settings.py`.
- **Frontend:** React 18 functional components + hooks. State lives in
  `useReducer` inside `<AppContext>`. Cross-feature flows go through
  `events.js`, not direct imports.
- **Naming:** descriptive (`pdf_hash`, not `hash`); no single-letter variables
  outside narrow math.

## Project layout

See `ARCHITECTURE.md` for the full layout, module boundaries, and how to add
a feature.

## Pull requests

- One commit per logical change.
- Run the test suite before opening a PR.
- Add a test for any new behavior.
- Update `README.md` / `ARCHITECTURE.md` if you add or change features.

## Reporting security issues

See `SECURITY.md`. Don't file public GitHub issues for security bugs.