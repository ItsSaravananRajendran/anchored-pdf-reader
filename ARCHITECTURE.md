# Architecture

A guided tour of the codebase for new contributors.

## Top-level

```
Browser (HTML + JS + CSS)
    ↓ HTTP/SSE
FastAPI (Python)
    ↓ SQL
SQLite (data/app.db)
    ↓ file I/O
PDF cache (data/pdfs/*.pdf by sha256)
    ↓ HTTPS
MiniMax API (LLM)
```

## Backend (`backend/`)

```
app.py            — composition root: create FastAPI, mount static,
                    include routers, serve /
settings.py       — env reads (MINIMAX_API_KEY, BIND_*, DATA_DIR, ...)
models.py         — Pydantic request/response models
db_schema.py      — SQLite connection + DDL
db_repos.py       — CRUD helpers (one file, one set of operations per table)
db.py             — back-compat re-export shim
pdf_ops.py        — PDF download, hash, text extraction, server-side render
minimax_client.py — streaming chat completion (with reasoning-tag stripping)
static.py         — NoCacheStatic (extends Starlette StaticFiles)
routers/
  pdfs.py         — /api/pdfs, /api/pdf/load, /api/pdf/{h}/info,
                    /api/pdf/{h}/text, /api/pdf/{h}/anchors, /healthz
  pdf_bytes.py    — /api/pdf/{h}/file (with Range), /page/{n}.png, /rect.png
  sessions.py     — /api/session/new, /{id}, /{id}/messages, DELETE
  chat.py         — /api/chat (SSE stream)
  anchors.py      — /api/anchor/{message_id} DELETE
```

### Conventions

- **All `os.getenv` lives in `settings.py`.** Modules that need a config
  value import from there. Required values raise at import time.
- **All request/response bodies are Pydantic models** in `models.py`.
  `rect` is typed as `RectModel` with validation (positive, ≤ 1.0).
- **All DB access goes through `db_repos` helpers.** Each function is a
  single focused operation; transactions are managed inside the helper.
- **Routers are thin.** They parse the request, call services, format the
  response. No business logic in routers.

### SSE streaming

`POST /api/chat` returns `text/event-stream`. Event types:

- `event: token\ndata: "<text>"\n\n` — assistant token
- `event: error\ndata: "<message>"\n\n` — provider error
- `event: done\ndata: {}\n\n` — terminal event

The generator persists message state to SQLite as it streams, so a
disconnected client gets a `stopped` status on the next load.

## Frontend (`frontend/src/`)

```
main.jsx                  — entry: <AppProvider><Shell /></AppProvider>
App.jsx                   — top-level wiring: hooks + components + handlers
state/
  AppContext.jsx          — context + useReducer
  reducer.js              — pure reducer (the ONLY state mutator)
  initialState.js         — empty shape
  actions.js              — action creators
events.js                 — pub/sub: on/off/emit
api/
  client.js               — fetch wrappers, one per endpoint
  sse.js                  — EventSource-style SSE parser
lib/
  utils.js                — uuid, escapeHtml, debounce, throttle, getCss
  rect.js                 — normalizeRect, hitTest, rectsEqual
  coords.js               — client↔normalized↔viewport transforms
  pdfjs.js                — lazy-resolve window.pdfjsLib
  markdown.js             — marked + KaTeX, only module that uses them
hooks/
  usePersistence.js       — zoom + chat-width → localStorage
  useVirtualPages.js      — virtual rendering (5/5 buffer, LRU)
  useDragSelection.js     — pointer drag → normalized rect
  useChatStream.js        — SSE → token callback
  usePageJump.js          — scroll-to-page + current-page indicator
  useSession.js           — session CRUD via API
  useLoadPdf.js           — URL/hash → PDF.js document + state updates
  useSendMessage.js       — full chat send flow (user + assistant + persistence)
  useFitWidthScale.js     — compute scale for "fit-width" zoom mode
components/               — see Components below
```

### State management

The **single source of truth** is the React Context exposed by
`<AppProvider>`. The reducer in `state/reducer.js` is the ONLY module that
mutates state. Components never assign to `state.x` directly — they call
`dispatch({ type: "...", payload: ... })`.

### Cross-feature flows (the event bus)

Feature modules never import each other directly — that creates cycles. They
publish and subscribe via `events.js` instead. For example:

- anchor click → `events.emit("anchor:clicked", ...)` → session hook subscribes
  → `events.emit("session:loaded", ...)` → chat hook subscribes → appends messages

This keeps the dep graph acyclic and `state.js` as the single mutator.

### Components

```
Reader.jsx              — scroll container with one PageCanvas per page
PageCanvas.jsx          — single PDF page (canvas + overlay)
ReaderToolbar.jsx       — URL bar, Load, Library, zoom, page-jump
PanelDivider.jsx        — drag handle between reader and chat
ChatPanel.jsx           — anchors + messages + composer
MessageBubble.jsx       — user or assistant message (markdown/KaTeX)
AnchorChip.jsx          — small thumbnail + page badge + delete button
AnchorsList.jsx         — sidebar of all anchors in current book
LibraryDropdown.jsx     — pick from cached PDFs
EmptyState.jsx          — shown when no PDF is loaded
LoadingState.jsx        — spinner while loading
ErrorState.jsx          — error with retry button
StatusBar.jsx           — bottom strip: title, pages, zoom
```

### Virtual rendering

A 500-page book at scale 1.0 with dpr=2 would allocate ~3 GB of canvas
backing store. `useVirtualPages` keeps that bounded:

- Only pages in/near the viewport (5 above + 5 below) are rendered.
- Pages outside the window are evicted (canvas width = 0).
- Max 3 concurrent renders (PDF.js renders are CPU-heavy).
- LRU eviction when the rendered count exceeds 11.

Algorithm details in `ARCHITECTURE.md` (search for "BUFFER_PAGES").

## Adding a new feature

1. **Decide which layer it belongs to:**
   - Pure logic (no DOM, no API) → `lib/`
   - State change without React → action in `state/actions.js` + case in `reducer.js`
   - Side effect with API → `hooks/`
   - Reusable UI → `components/`

2. **Add tests.** HTTP-level for backend; browser-level for UI changes.

3. **Update this file** if you add a new layer or change a convention.

## File budget

Every authored source file is ≤ 250 lines. If a file grows past this, the
PR is rejected. Use extraction to split.