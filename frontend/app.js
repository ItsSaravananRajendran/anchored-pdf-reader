// PDF Reader + Anchored AI Chat — frontend
// Vanilla JS, no build step. PDF.js loaded as ESM from CDN.

import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.worker.min.mjs";

// ---- State ----------------------------------------------------------
const state = {
  pdfHash: null,
  pageCount: 0,
  title: null,
  pdfDoc: null,            // pdf.js document
  currentPage: 1,
  zoomMode: "1.0",         // "1.0" | "1.25" | ... | "fit-width" — string from the select
  scale: 1.5,              // numeric scale currently applied (derived from zoomMode)
  pendingAnchor: null,     // {page, rect:{x,y,w,h}, rotation, thumbDataUrl}
  historicalAnchors: [],   // [{page, rect, rotation, thumbDataUrl, messageId, text}]
  allBookAnchors: [],      // every anchor for the current book across all sessions
  sessionId: null,
  viewingOldSession: false,  // true after loadSessionForAnchor; first send starts a new session
  abortController: null,
};

// ---- DOM refs -------------------------------------------------------
const $ = (id) => document.getElementById(id);
const els = {
  urlInput: $("urlInput"),
  loadBtn: $("loadBtn"),
  loadStatus: $("loadStatus"),
  pdfTitle: $("pdfTitle"),
  pageIndicator: $("pageIndicator"),
  prevPage: $("prevPage"),
  nextPage: $("nextPage"),
  pdfScroll: $("pdfScroll"),
  pdfCanvasWrap: $("pdfCanvasWrap"),
  pdfCanvas: $("pdfCanvas"),
  overlay: $("overlay"),
  newSessionBtn: $("newSessionBtn"),
  libraryCount: $("libraryCount"),
  libraryList: $("libraryList"),
  anchorsCount: $("anchorsCount"),
  anchorsList: $("anchorsList"),
  messages: $("messages"),
  composerInput: $("composerInput"),
  sendBtn: $("sendBtn"),
  pendingChip: $("pendingChip"),
  pendingThumb: $("pendingThumb"),
  pendingLabel: $("pendingLabel"),
  clearChip: $("clearChip"),
  pageJump: $("pageJump"),
  zoomSelect: $("zoomSelect"),
  panelDivider: $("panelDivider"),
  hint: $("hint"),
  sessionLabel: $("sessionLabel"),
};

// ---- Helpers --------------------------------------------------------
function setStatus(text, kind = "") {
  els.loadStatus.textContent = text;
  els.loadStatus.className = `muted ${kind ? "status-" + kind : ""}`;
}

function setHint(text) {
  els.hint.textContent = text;
}

function uuid() {
  // crypto.randomUUID requires a secure context (HTTPS or localhost).
  // Tailscale IPs and other non-localhost addresses don't qualify, so
  // fall back to a Math.random-based ID that works everywhere.
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return "m-" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  }
  return "m-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---- Markdown + math rendering ----
// We trust the model output (it's our own LLM and the user explicitly asked for it).
// marked handles HTML escaping by default for normal text. Inline HTML is escaped.
const _mdState = { ready: false };
function _tryInitMarkdown() {
  if (_mdState.ready) return;
  if (typeof window.marked === "undefined" || typeof window.katex === "undefined") return;
  // marked configuration: GFM, no auto-header IDs (causes issues on re-render), no mangle
  window.marked.setOptions({
    gfm: true,
    breaks: true,
    headerIds: false,
    mangle: false,
  });
  // Custom extension: render $...$ and $$...$$ math before marked touches the source
  window.marked.use({
    extensions: [{
      name: "math",
      level: "inline",
      start(src) { return src.match(/\$/)?.index; },
      tokenizer(src) {
        const blockMatch = /^\$\$([\s\S]+?)\$\$/.exec(src);
        if (blockMatch) {
          return { type: "math", raw: blockMatch[0], text: blockMatch[1], displayMode: true };
        }
        const inlineMatch = /^\$([^$\n]+?)\$/.exec(src);
        if (inlineMatch) {
          return { type: "math", raw: inlineMatch[0], text: inlineMatch[1], displayMode: false };
        }
        return undefined;
      },
      renderer(token) {
        try {
          return window.katex.renderToString(token.text, {
            displayMode: token.displayMode,
            throwOnError: false,
            output: "html",
          });
        } catch (e) {
          return escapeHtml(token.raw);
        }
      },
    }],
  });
  _mdState.ready = true;
}

function renderMarkdown(text) {
  _tryInitMarkdown();
  if (!_mdState.ready) {
    // CDN scripts not loaded yet — fall back to escaped text
    return escapeHtml(text);
  }
  try {
    return window.marked.parse(text);
  } catch (e) {
    return escapeHtml(text);
  }
}

const _pendingRenders = new WeakMap();
function renderAssistantBody(el, text) {
  // Debounce: only the latest pending render actually runs, so a 100ms token burst
  // doesn't trigger 50 marked+KaTeX passes.
  const body = el.querySelector(".body");
  if (!body) return;
  body.textContent = text;  // immediate plain text update so the user sees streaming
  if (_pendingRenders.has(body)) clearTimeout(_pendingRenders.get(body));
  const handle = setTimeout(() => {
    if (body.textContent === text) {
      body.innerHTML = renderMarkdown(text);
      // re-scroll after layout change
      autoscroll();
    }
  }, 120);
  _pendingRenders.set(body, handle);
}

// ---- PDF rendering (continuous scroll) -----------------------------
// We render all pages as separate canvases stacked vertically inside #pdfScroll.
// Each page has its own overlay canvas (positioned absolutely on top).
// state.pages[pageNum] caches { canvas, overlay, wrap, viewport, rendered }

state.pages = {};  // pageNum -> { canvas, overlay, wrap, viewport, rendered }

async function renderAllPages() {
  if (!state.pdfDoc) return;
  // Clear any existing pages
  els.pdfCanvasWrap.innerHTML = "";
  state.pages = {};

  // Resolve the actual scale: either a fixed value from zoomMode, or fit-width
  await resolveFitWidthIfNeeded();
  for (let p = 1; p <= state.pageCount; p++) {
    const wrap = document.createElement("div");
    wrap.className = "pdf-page-wrap";
    wrap.dataset.page = p;
    const canvas = document.createElement("canvas");
    canvas.className = "pdf-page-canvas";
    const overlay = document.createElement("canvas");
    overlay.className = "pdf-page-overlay";
    wrap.appendChild(canvas);
    wrap.appendChild(overlay);
    els.pdfCanvasWrap.appendChild(wrap);
    state.pages[p] = { canvas, overlay, wrap, viewport: null, rendered: false, lastUsed: 0 };
  }

  // Wire the scroll observer to lazily render pages in/near the viewport.
  observePageVisibility();
  // Kick off renders for the initial viewport.
  const initial = pagesInViewport();
  for (const p of initial) scheduleRender(p);
  updatePageIndicator(state.currentPage || 1);
}

// Resolve the actual scale: either a fixed value from zoomMode, or fit-width.
async function resolveFitWidthIfNeeded() {
  if (state.zoomMode === "fit-width") {
    if (!state.pdfDoc) return;
    const samplePage = await state.pdfDoc.getPage(1);
    const naturalViewport = samplePage.getViewport({ scale: 1.0, rotation: 0 });
    const containerWidth = els.pdfScroll.clientWidth - 32;  // minus padding
    state.scale = Math.max(0.25, containerWidth / naturalViewport.width);
  } else {
    state.scale = parseFloat(state.zoomMode) || 1.0;
  }
}

// ---- Virtual rendering: keep at most MAX_RENDERED_PAGES in memory ----
const MAX_RENDERED_PAGES = 30;
const BUFFER_PAGES = 2;  // render N pages above and below the viewport
const MAX_CONCURRENT_RENDERS = 3;
let _activeRenders = 0;
const _renderQueue = [];

function pagesInViewport() {
  // Returns the set of page numbers that should be rendered given the current
  // scroll position. Unrendered wraps have height 0 (canvas not sized yet),
  // so we use a natural page height estimate as a fallback. The estimate is
  // computed from state.scale (which is set before any rendering happens).
  const scroll = els.pdfScroll;
  if (!scroll) return [];
  const scrollTop = scroll.scrollTop;
  const viewportH = scroll.clientHeight;
  // Buffer: include 1 full page worth above and below the viewport, in pixels
  // at the current scale. PDF page is typically 842pt tall = 1123px at scale 1.0,
  // or 842 * scale at our scale.
  const naturalPageH = 842 * state.scale;  // 842pt ≈ 11.7in letter height
  const top = scrollTop - naturalPageH * BUFFER_PAGES;
  const bottom = scrollTop + viewportH + naturalPageH * BUFFER_PAGES;
  // Estimate each page's offsetTop by accumulating naturalPageH for unrendered
  // pages, and the real offsetHeight for rendered ones.
  let cumulative = 0;
  const result = [];
  for (let p = 1; p <= state.pageCount; p++) {
    const entry = state.pages[p];
    if (!entry) continue;
    const wrapTop = entry.wrap.offsetTop;
    const realH = entry.wrap.offsetHeight || 0;
    // For unrendered pages, offsetTop might be 0 (we just created them all at once).
    // Estimate: cumulative + page index * natural page height
    let effectiveTop, effectiveH;
    if (realH > 0) {
      effectiveTop = wrapTop;
      effectiveH = realH;
    } else {
      effectiveTop = cumulative;
      effectiveH = naturalPageH;
    }
    if (effectiveTop + effectiveH >= top && effectiveTop <= bottom) {
      result.push(p);
    }
    cumulative += naturalPageH;  // use natural height for next estimate
  }
  return result;
}

function _evictIfOverBudget() {
  // If we've rendered more than the budget, evict the least-recently-used page
  // (i.e. the one furthest from the current viewport). Released pages keep their
  // wrap div (so layout is stable) but their canvas is cleared and `rendered=false`.
  const rendered = Object.values(state.pages).filter(e => e && e.rendered);
  if (rendered.length <= MAX_RENDERED_PAGES) return;
  // Sort by distance from current viewport center, then by lastUsed (oldest first)
  const scrollCenter = els.pdfScroll.scrollTop + els.pdfScroll.clientHeight / 2;
  rendered.sort((a, b) => {
    const aDist = Math.abs((a.wrap.offsetTop + a.wrap.offsetHeight / 2) - scrollCenter);
    const bDist = Math.abs((b.wrap.offsetTop + b.wrap.offsetHeight / 2) - scrollCenter);
    if (aDist !== bDist) return bDist - aDist;  // furthest first
    return a.lastUsed - b.lastUsed;              // older first
  });
  const toEvict = rendered.length - MAX_RENDERED_PAGES;
  for (let i = 0; i < toEvict; i++) {
    _evictPage(rendered[i]);
  }
}

function _evictPage(entry) {
  // Free the canvas backing store; reset state so the page can be re-rendered
  // on demand. Keep the wrap div so layout doesn't shift.
  entry.canvas.width = 0;
  entry.canvas.height = 0;
  entry.overlay.width = 0;
  entry.overlay.height = 0;
  entry.canvas.getContext("2d").clearRect(0, 0, 0, 0);
  entry.overlay.getContext("2d").clearRect(0, 0, 0, 0);
  entry.rendered = false;
  entry.renderedAt = -1;
  entry.viewport = null;
}

function scheduleRender(pageNum) {
  const entry = state.pages[pageNum];
  if (!entry) return;
  if (entry.rendered && entry.renderedAt === state.scale) return;
  if (entry.rendering) return;
  if (_renderQueue.includes(pageNum)) return;
  _renderQueue.push(pageNum);
  _drainRenderQueue();
}

function _drainRenderQueue() {
  while (_activeRenders < MAX_CONCURRENT_RENDERS && _renderQueue.length > 0) {
    const p = _renderQueue.shift();
    _activeRenders++;
    renderPage(p).finally(() => {
      _activeRenders--;
      _drainRenderQueue();
    });
  }
}

// Re-render every page at the current zoom. For the virtual-rendering case,
// we only touch pages that are currently rendered (in viewport). Other pages
// will be re-rendered on demand when scrolled into view.
async function applyZoom(newMode) {
  if (!state.pdfDoc) {
    state.zoomMode = newMode;
    persistPrefs();
    els.zoomSelect.value = newMode;
    return;
  }
  // Remember which page the user is currently viewing
  const currentPage = state.currentPage || 1;
  const oldPageTop = state.pages[currentPage] ? state.pages[currentPage].wrap.offsetTop : 0;
  const oldPageHeight = state.pages[currentPage] ? state.pages[currentPage].wrap.offsetHeight : 0;

  // Update mode + scale
  state.zoomMode = newMode;
  await resolveFitWidthIfNeeded();
  els.zoomSelect.value = newMode;
  persistPrefs();

  // Mark all pages as needing re-render. We clear the canvas (free memory)
  // and reset the min-height so off-viewport wraps collapse to 0 until they're
  // re-rendered. This keeps the document scrollHeight at "visible pages only"
  // during zoom, which avoids the layout thrash that comes from re-rendering
  // 500 pages.
  for (const pStr in state.pages) {
    const p = parseInt(pStr, 10);
    const entry = state.pages[p];
    if (entry.rendered || entry.rendering) {
      _evictPage(entry);
    } else {
      // Never rendered — just clear the min-height
      entry.wrap.style.minHeight = "0";
    }
  }
  // Re-render the visible pages
  const visible = pagesInViewport();
  for (const p of visible) scheduleRender(p);
  await _waitForRenders();

  // Restore scroll position so the user stays on the same page
  if (oldPageTop > 0 && state.pages[currentPage]) {
    const newPageTop = state.pages[currentPage].wrap.offsetTop;
    const newPageHeight = state.pages[currentPage].wrap.offsetHeight;
    let relOffset = 0;
    if (oldPageHeight > 0) {
      const oldScrollOffset = els.pdfScroll.scrollTop - oldPageTop;
      relOffset = (oldScrollOffset / oldPageHeight) * newPageHeight;
    }
    els.pdfScroll.scrollTop = newPageTop + relOffset;
  }
}

// Wait for the queue + in-flight renders to drain (with a hard timeout)
async function _waitForRenders(timeoutMs = 5000) {
  const start = Date.now();
  while ((_renderQueue.length > 0 || _activeRenders > 0) && Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 50));
  }
}

async function renderPage(pageNum) {
  if (!state.pdfDoc) return;
  const entry = state.pages[pageNum];
  // If we already have a render at the current scale, nothing to do.
  if (!entry || (entry.rendered && entry.renderedAt === state.scale)) return;
  // Capture the scale at the START of the render. If it changes during
  // rendering, we discard this render and let the next call do it.
  const scaleAtStart = state.scale;
  entry.rendering = true;
  try {
    const page = await state.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: scaleAtStart, rotation: 0 });
    entry.viewport = viewport;

    const dpr = window.devicePixelRatio || 1;
    entry.canvas.width = viewport.width * dpr;
    entry.canvas.height = viewport.height * dpr;
    entry.canvas.style.width = viewport.width + "px";
    entry.canvas.style.height = viewport.height + "px";
    entry.wrap.style.width = viewport.width + "px";
    // Lock the wrap height so eviction of the canvas doesn't collapse the layout
    entry.wrap.style.minHeight = viewport.height + "px";

    entry.overlay.width = entry.canvas.width;
    entry.overlay.height = entry.canvas.height;
    entry.overlay.style.width = entry.canvas.style.width;
    entry.overlay.style.height = entry.canvas.style.height;

    const ctx = entry.canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const task = page.render({ canvasContext: ctx, viewport });
    try {
      await task.promise;
    } catch (e) {
      if (e && e.name === "RenderingCancelledException") return;
      throw e;
    }
    // Zoom changed during this render — abandon and let the next call redo it
    if (state.scale !== scaleAtStart) return;
    entry.rendered = true;
    entry.renderedAt = scaleAtStart;
    entry.lastUsed = Date.now();
    // Wire interactions on this overlay
    setupOverlayInteractionsForPage(pageNum);
    // Draw any existing anchors on this page
    drawPageOverlay(pageNum);
    // Free canvas memory for pages we're not using
    _evictIfOverBudget();
  } finally {
    entry.rendering = false;
  }
}

let _intersectionObserver = null;
let _scrollDebounce = null;
let _lastScrollTop = -1;
function observePageVisibility() {
  if (_intersectionObserver) _intersectionObserver.disconnect();
  // Track scroll position; render pages that come into the visible area, evict
  // pages that scroll out. Debounced so we don't thrash during fast scrolling.
  // We only fire on actual user-initiated scroll — i.e. scrollTop changed since
  // the last time we handled a scroll. This prevents a render → scrollHeight
  // change → scroll event → re-render → ... loop.
  els.pdfScroll?.addEventListener("scroll", () => {
    if (_scrollDebounce) clearTimeout(_scrollDebounce);
    _scrollDebounce = setTimeout(() => {
      const newTop = els.pdfScroll.scrollTop;
      if (newTop === _lastScrollTop) return;  // only scrollHeight changed, not user scroll
      _lastScrollTop = newTop;
      const visible = pagesInViewport();
      for (const p of visible) scheduleRender(p);
      updateCurrentPageFromScroll();
    }, 80);
  }, { passive: true });
}

function updateCurrentPageFromScroll() {
  const scroll = els.pdfScroll;
  const scrollTop = scroll.scrollTop;
  const viewportH = scroll.clientHeight;
  const scrollCenter = scrollTop + viewportH / 2;
  let best = 1;
  let bestDist = Infinity;
  for (const pStr in state.pages) {
    const p = parseInt(pStr, 10);
    const top = state.pages[p].wrap.offsetTop;
    const center = top + state.pages[p].wrap.offsetHeight / 2;
    const d = Math.abs(center - scrollCenter);
    if (d < bestDist) { bestDist = d; best = p; }
  }
  if (best !== state.currentPage) {
    state.currentPage = best;
    updatePageIndicator(best);
  }
}

function updatePageIndicator(page) {
  els.pageIndicator.textContent = `${page} / ${state.pageCount}`;
  els.pageJump.value = page;
  els.pageJump.max = state.pageCount;
  els.prevPage.disabled = page <= 1;
  els.nextPage.disabled = page >= state.pageCount;
}

function drawAllOverlays() {
  for (const pStr in state.pages) {
    drawPageOverlay(parseInt(pStr, 10));
  }
}

function drawPageOverlay(pageNum) {
  const entry = state.pages[pageNum];
  if (!entry || !entry.rendered) return;
  const ctx = entry.overlay.getContext("2d");
  ctx.clearRect(0, 0, entry.overlay.width, entry.overlay.height);
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Historical anchors on this page
  for (const a of state.historicalAnchors) {
    if (a.page !== pageNum) continue;
    drawRect(ctx, a.rect, "historical", a.messageId, entry.viewport);
  }
  // Pending on this page
  if (state.pendingAnchor && state.pendingAnchor.page === pageNum) {
    drawRect(ctx, state.pendingAnchor.rect, "pending", null, entry.viewport, true);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function drawRect(ctx, rect, kind, messageId, viewport, dashed = false) {
  if (!viewport) return;
  const x = rect.x * viewport.width;
  const y = rect.y * viewport.height;
  const w = rect.w * viewport.width;
  const h = rect.h * viewport.height;
  const color = kind === "pending" ? getCss("--pending-stroke") : getCss("--historical-stroke");
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.fillStyle = color + "22";
  ctx.beginPath();
  if (dashed) ctx.setLineDash([6, 4]); else ctx.setLineDash([]);
  ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
}

// Backwards-compat shim: drawOverlay() now draws all pages
function drawOverlay() { drawAllOverlays(); }

function getCss(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#6366f1";
}

// ---- PDF load -------------------------------------------------------
async function openPdfByHash(pdfHash) {
  setStatus("loading…");
  try {
    const infoR = await fetch(`/api/pdf/${pdfHash}/info`);
    if (!infoR.ok) throw new Error(`HTTP ${infoR.status}`);
    const info = await infoR.json();
    state.pdfHash = info.pdf_hash;
    state.pageCount = info.page_count || 0;
    state.title = info.title || info.url?.split("/").pop() || "untitled";
    els.pdfTitle.textContent = state.title;
    els.urlInput.value = info.url || "";

    state.pdfDoc = await pdfjsLib.getDocument({
      url: `/api/pdf/${state.pdfHash}/file`,
      disableAutoFetch: true,
      disableStream: true,
      rangeChunkSize: 65536,
    }).promise;

    // Start a new chat session
    const sr = await fetch("/api/session/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdf_hash: state.pdfHash }),
    });
    const sd = await sr.json();
    state.sessionId = sd.session_id;
    els.sessionLabel.textContent = "new session";

    setStatus("loaded", "ok");
    await renderAllPages();
    els.composerInput.disabled = false;
    els.composerInput.placeholder = "Drag on the page to set an anchor, then ask…";
    await refreshBookAnchors();
  } catch (e) {
    setStatus(`error: ${e.message}`, "error");
    console.error(e);
  }
}

async function loadPdf(url) {
  setStatus("downloading…");
  els.loadBtn.disabled = true;
  try {
    const r = await fetch("/api/pdf/load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(t || `HTTP ${r.status}`);
    }
    const data = await r.json();
    // After download, do the standard open path
    state.pdfHash = data.pdf_hash;  // set so the next openPdfByHash call can reuse
    await openPdfByHash(data.pdf_hash);
  } catch (e) {
    setStatus(`error: ${e.message}`, "error");
    console.error(e);
  } finally {
    els.loadBtn.disabled = false;
  }
}

// ---- Library listing -----------------------------------------------

async function refreshLibrary() {
  try {
    const r = await fetch("/api/pdfs");
    const d = await r.json();
    const items = d.items || [];
    els.libraryCount.textContent = items.length > 0 ? `(${items.length})` : "—";
    els.libraryList.innerHTML = "";
    if (items.length === 0) {
      els.libraryList.innerHTML = `<div class="library-empty">No books yet. Load a PDF URL above.</div>`;
      return;
    }
    for (const it of items) {
      const div = document.createElement("div");
      div.className = "library-item" + (it.pdf_hash === state.pdfHash ? " current" : "");
      const titleText = it.title || it.url.split("/").pop() || "untitled";
      const lastSeen = it.last_session_at
        ? new Date(it.last_session_at * 1000).toLocaleString()
        : "never opened";
      div.innerHTML = `
        <span class="lib-title">${escapeHtml(titleText)}</span>
        <span class="lib-meta">
          ${it.page_count || "?"} pages ·
          ${it.message_count} question${it.message_count === 1 ? "" : "s"} ·
          ${it.session_count} session${it.session_count === 1 ? "" : "s"} ·
          last: ${escapeHtml(lastSeen)}
        </span>
      `;
      div.addEventListener("click", () => {
        // Close the dropdown
        document.getElementById("libraryDropdown").open = false;
        if (it.pdf_hash === state.pdfHash) return;  // already open
        if (state.abortController) state.abortController.abort();
        els.messages.innerHTML = "";
        state.historicalAnchors = [];
        openPdfByHash(it.pdf_hash);
      });
      els.libraryList.appendChild(div);
    }
  } catch (e) {
    console.error("library refresh failed:", e);
  }
}

async function refreshBookAnchors() {
  if (!state.pdfHash) {
    state.allBookAnchors = [];
    renderAnchorsList();
    return;
  }
  try {
    const r = await fetch(`/api/pdf/${state.pdfHash}/anchors`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    state.allBookAnchors = d.anchors || [];
    // Build a quick lookup for the overlay
    state.historicalAnchors = state.allBookAnchors.map(a => ({
      page: a.anchor_page,
      rect: a.anchor_rect,
      rotation: a.anchor_rotation,
      messageId: a.message_id,
      role: a.role,
      text: a.text,
    }));
    renderAnchorsList();
    drawOverlay();
  } catch (e) {
    console.error("anchors refresh failed:", e);
  }
}

function renderAnchorsList() {
  const items = state.allBookAnchors;
  els.anchorsCount.textContent = `(${items.length})`;
  els.anchorsList.innerHTML = "";
  if (items.length === 0) {
    els.anchorsList.innerHTML = `<div class="anchor-empty">No anchors yet. Drag on a page to make one.</div>`;
    return;
  }
  for (const a of items) {
    const row = document.createElement("div");
    row.className = "anchor-row";
    // For user messages: show the question. For assistant: show a trimmed answer.
    // Always strip think tags from the preview.
    const cleanText = (a.text || "").replace(/<think>[\s\S]*?<\/think>/g, "").replace(/\s+/g, " ").trim();
    const isUser = a.role === "user";
    const preview = cleanText.slice(0, isUser ? 80 : 50);
    row.innerHTML = `
      <span class="page-badge">p. ${a.anchor_page}</span>
      <span class="text-preview">${isUser ? "❓" : "💬"} ${escapeHtml(preview || "(no text)")}</span>
      <button class="anchor-delete" title="Delete this Q&A pair" aria-label="Delete">×</button>
    `;
    row.addEventListener("click", (e) => {
      if (e.target.classList.contains("anchor-delete")) return;  // handled by button
      loadSessionForAnchor(a);
    });
    row.querySelector(".anchor-delete").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Delete this question and its answer? This cannot be undone.")) return;
      try {
        const r = await fetch(`/api/anchor/${encodeURIComponent(a.message_id)}`, { method: "DELETE" });
        if (!r.ok) {
          const t = await r.text();
          alert("Delete failed: " + t);
          return;
        }
        // Remove the corresponding chat messages from the UI
        const sessionId = a.session_id;
        document.querySelectorAll(`.message[data-session-id="${sessionId}"]`).forEach(el => {
          if (el.dataset.anchorPage == a.anchor_page) {
            const r = JSON.stringify(JSON.parse(el.dataset.anchorRect || "{}"));
            const t = JSON.stringify(a.anchor_rect);
            if (r === t) el.remove();
          }
        });
        // Refresh lists and the on-page overlays
        await refreshBookAnchors();
        await refreshLibrary();
      } catch (err) {
        alert("Delete failed: " + err.message);
      }
    });
    els.anchorsList.appendChild(row);
  }
}

// Boot: refresh library on page load
refreshLibrary();

// Refresh anchors when the user sends a new question
const _origSendMessage = sendMessage;
// (wrap with a post-send hook)
async function _wrapSendMessage() {
  await _origSendMessage.apply(this, arguments);
  await refreshBookAnchors();
  await refreshLibrary();
}
// Replace the global reference so click handlers use the wrapped version
sendMessage = _wrapSendMessage;
// Per-page overlay interactions. Called once per page when the page renders.
function setupOverlayInteractionsForPage(pageNum) {
  const entry = state.pages[pageNum];
  if (!entry || entry.interactionsWired) return;
  entry.interactionsWired = true;
  const overlay = entry.overlay;
  let dragging = false;
  let start = null;
  let cur = null;
  // True if the most recent pointerdown was on a historical anchor. The click
  // is only confirmed on pointerup if the user didn't drag far.
  let clickedOnAnchor = false;
  let clickedAnchor = null;

  function point(e) {
    const r = overlay.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height,
    };
  }

  function hitTestAnchor(p) {
    // Returns the anchor at normalized point p, or null.
    for (const a of state.historicalAnchors) {
      if (a.page !== pageNum) continue;
      const r = a.rect;
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return a;
    }
    return null;
  }

  overlay.addEventListener("pointerdown", (e) => {
    if (!state.pdfDoc) return;
    const p = point(e);
    const hit = hitTestAnchor(p);
    if (hit) {
      // Tentative click: remember the anchor + start point. If the user moves
      // enough before pointerup, abandon the click and start a new draw.
      clickedOnAnchor = true;
      clickedAnchor = hit;
      dragging = false;
      start = p;  // needed so the move-distance check works
      return;
    }
    clickedOnAnchor = false;
    clickedAnchor = null;
    overlay.setPointerCapture(e.pointerId);
    dragging = true;
    start = p;
    cur = p;
    state.currentPage = pageNum;
    updatePageIndicator(pageNum);
  });
  overlay.addEventListener("pointermove", (e) => {
    if (clickedOnAnchor && !dragging) {
      // Check if the user has moved enough to abandon the click intent
      const p = point(e);
      if (start && Math.hypot(p.x - start.x, p.y - start.y) > 0.02) {
        // User is dragging away from the anchor — start a new draw instead
        clickedOnAnchor = false;
        clickedAnchor = null;
        try { overlay.setPointerCapture(e.pointerId); } catch (e) {}
        dragging = true;
        start = p;
        cur = p;
        state.currentPage = pageNum;
        updatePageIndicator(pageNum);
        return;
      }
      return;
    }
    if (!dragging) return;
    cur = point(e);
    drawDragPreview();
  });
  overlay.addEventListener("pointerup", async (e) => {
    if (clickedOnAnchor && clickedAnchor) {
      // Confirm the click: load the session
      try { await loadSessionForAnchor(clickedAnchor); } catch (err) { console.error(err); }
      clickedOnAnchor = false;
      clickedAnchor = null;
      return;
    }
    if (!dragging) return;
    dragging = false;
    try { overlay.releasePointerCapture(e.pointerId); } catch (e) {}
    const a = normalizeRect(start, cur);
    if (a.w * a.h < 0.0005) {
      drawPageOverlay(pageNum);
      return;
    }
    await setPendingAnchor(a, pageNum);
  });
  overlay.addEventListener("pointercancel", () => {
    dragging = false;
    clickedOnAnchor = false;
    clickedAnchor = null;
    drawPageOverlay(pageNum);
  });

  function drawDragPreview() {
    drawPageOverlay(pageNum);
    if (!start || !cur) return;
    const ctx = overlay.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const a = normalizeRect(start, cur);
    drawRect(ctx, a, "pending", null, entry.viewport, true);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

// Global keyboard shortcuts (work regardless of which page is mounted)
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.pendingAnchor) {
    clearPendingAnchor();
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "N") {
    e.preventDefault();
    newSession();
  }
});

// Backwards-compat: legacy function name now a no-op (per-page wiring is done in renderPage)
function setupOverlayInteractions() { /* no-op: handled per page */ }

function normalizeRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(a.x - b.x);
  const h = Math.abs(a.y - b.y);
  return { x, y, w, h };
}

async function setPendingAnchor(rect, pageNum) {
  state.pendingAnchor = {
    page: pageNum,
    rect,
    rotation: 0,
  };
  // Generate thumbnail by rendering the rect on the current page
  const thumb = await renderRectThumb(rect, pageNum);
  state.pendingAnchor.thumbDataUrl = thumb;
  els.pendingThumb.src = thumb;
  els.pendingLabel.textContent = `p. ${pageNum}`;
  els.pendingChip.classList.remove("hidden");
  els.composerInput.disabled = false;
  els.sendBtn.disabled = false;
  setHint("Anchor set. Type your question and Send.");
  drawPageOverlay(pageNum);
}

function clearPendingAnchor() {
  const page = state.pendingAnchor ? state.pendingAnchor.page : null;
  state.pendingAnchor = null;
  els.pendingChip.classList.add("hidden");
  els.pendingThumb.src = "";
  els.sendBtn.disabled = true;
  setHint("Drag on the page to set an anchor.");
  if (page !== null) drawPageOverlay(page);
  else drawAllOverlays();
}

async function renderRectThumb(rect, pageNum) {
  const entry = state.pages[pageNum];
  if (!entry || !entry.viewport) return "";
  const v = entry.viewport;
  const tmp = document.createElement("canvas");
  const w = Math.max(1, Math.round(rect.w * v.width));
  const h = Math.max(1, Math.round(rect.h * v.height));
  tmp.width = w;
  tmp.height = h;
  const ctx = tmp.getContext("2d");
  ctx.drawImage(
    entry.canvas,
    Math.round(rect.x * entry.canvas.width),
    Math.round(rect.y * entry.canvas.height),
    Math.round(rect.w * entry.canvas.width),
    Math.round(rect.h * entry.canvas.height),
    0, 0, w, h
  );
  return tmp.toDataURL("image/png");
}

// ---- Page nav (continuous scroll = smooth) -------------------------
function scrollToPage(pageNum, smooth = true) {
  if (!state.pages[pageNum]) return Promise.resolve();
  const wrap = state.pages[pageNum].wrap;
  if (!wrap) return Promise.resolve();
  // Make sure the target page is rendered before we read its offsetTop
  // (an unrendered wrap has no real height — its offsetTop is wrong).
  scheduleRender(pageNum);
  return _waitForRenders().then(() => {
    // Force a synchronous layout read so offsetTop is accurate.
    const top = wrap.getBoundingClientRect().top + els.pdfScroll.scrollTop - 8;
    els.pdfScroll.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
    state.currentPage = pageNum;
    updatePageIndicator(pageNum);
    // Track the new scrollTop so the scroll handler doesn't re-fire
    _lastScrollTop = top;
  });
}

els.prevPage?.addEventListener("click", () => {
  const target = Math.max(1, state.currentPage - 1);
  scrollToPage(target);
});
els.nextPage?.addEventListener("click", () => {
  const target = Math.min(state.pageCount, state.currentPage + 1);
  scrollToPage(target);
});
els.pageJump?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const n = parseInt(els.pageJump.value, 10);
    if (n >= 1 && n <= state.pageCount) {
      scrollToPage(n);
    }
  }
});
els.pageJump?.addEventListener("focus", () => els.pageJump.select());

// ---- Zoom -----------------------------------------------------------
els.zoomSelect?.addEventListener("change", () => {
  applyZoom(els.zoomSelect.value);
});

// ---- Panel divider (resize chat) ------------------------------------
let _isResizing = false;
let _resizeStartX = 0;
let _resizeStartChatW = 0;
els.panelDivider?.addEventListener("pointerdown", (e) => {
  _isResizing = true;
  _resizeStartX = e.clientX;
  _resizeStartChatW = getChatWidth();
  document.body.classList.add("is-resizing");
  els.panelDivider.setPointerCapture(e.pointerId);
});
els.panelDivider?.addEventListener("pointermove", (e) => {
  if (!_isResizing) return;
  const dx = _resizeStartX - e.clientX;  // dragging left = chat grows
  const newW = Math.max(240, Math.min(window.innerWidth - 320, _resizeStartChatW + dx));
  setChatWidth(newW);
  persistPrefs();
});
els.panelDivider?.addEventListener("pointerup", (e) => {
  _isResizing = false;
  document.body.classList.remove("is-resizing");
  try { els.panelDivider.releasePointerCapture(e.pointerId); } catch (err) {}
  // If a fit-width is active, re-render so the page fills the new container width
  if (state.zoomMode === "fit-width" && state.pdfDoc) {
    applyZoom("fit-width");
  }
});
els.panelDivider?.addEventListener("pointercancel", () => {
  _isResizing = false;
  document.body.classList.remove("is-resizing");
});

function getChatWidth() {
  // Read the third column from the grid template
  const cs = getComputedStyle(document.querySelector(".app"));
  const parts = cs.gridTemplateColumns.split(/\s+/);
  // With the divider in column 2, chat is column 3
  return parseFloat(parts[2]) || 420;
}

function setChatWidth(w) {
  document.querySelector(".app").style.gridTemplateColumns = `1fr 6px ${w}px`;
}

// ---- Preferences (localStorage) -------------------------------------
const PREFS_KEY = "pdfreader.prefs.v1";
function loadPrefs() {
  try {
    const s = localStorage.getItem(PREFS_KEY);
    if (!s) return {};
    return JSON.parse(s);
  } catch (e) { return {}; }
}
function persistPrefs() {
  try {
    const prefs = {
      zoomMode: state.zoomMode,
      chatWidth: getChatWidth(),
    };
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (e) {}
}
function applyPrefs() {
  const p = loadPrefs();
  if (p.zoomMode) {
    state.zoomMode = p.zoomMode;
    if (els.zoomSelect) els.zoomSelect.value = p.zoomMode;
  }
  if (p.chatWidth && Number.isFinite(p.chatWidth)) {
    setChatWidth(p.chatWidth);
  }
}

applyPrefs();

// ---- Load URL -------------------------------------------------------
els.loadBtn.addEventListener("click", () => {
  const u = els.urlInput.value.trim();
  if (u) loadPdf(u);
});
els.urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") els.loadBtn.click();
});

els.clearChip.addEventListener("click", clearPendingAnchor);

// ---- New session ----------------------------------------------------
els.newSessionBtn.addEventListener("click", async () => {
  if (!state.pdfHash) return;
  if (els.messages.children.length > 0) {
    if (!confirm("Clear the chat for this PDF?")) return;
  }
  await newSession();
});

// Load a session by id and replace the chat panel with its messages.
// Triggered by clicking an anchor (sidebar row, on-page rectangle, or chat chip).
// If the anchor doesn't belong to the currently-active session, we mark the
// composer as "viewing old" so the next send creates a fresh session instead
// of appending to the historical one.
async function loadSessionForAnchor(anchor) {
  const sessionId = anchor.session_id;
  if (!sessionId) return;
  // Cancel any in-flight generation
  if (state.abortController) {
    try { state.abortController.abort(); } catch (e) {}
    state.abortController = null;
  }
  let resp;
  try {
    const r = await fetch(`/api/session/${encodeURIComponent(sessionId)}/messages`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    resp = await r.json();
  } catch (e) {
    alert("Failed to load session: " + e.message);
    return;
  }
  if (resp.pdf_hash && resp.pdf_hash !== state.pdfHash) {
    alert("This anchor belongs to a different PDF. Open that PDF from the library first.");
    return;
  }
  // Clear the chat panel and render the loaded messages
  els.messages.innerHTML = "";
  let targetMessageEl = null;
  for (const m of resp.messages) {
    const el = appendMessage({
      id: m.id,
      role: m.role,
      text: m.text,
      anchor_page: m.anchor_page,
      anchor_rect: m.anchor_rect,
      anchor_rotation: m.anchor_rotation,
      thumbDataUrl: null,  // we don't have stored thumbnails; ok for now
      status: m.status,
      session_id: m.session_id,
    });
    if (m.id === anchor.message_id) targetMessageEl = el;
  }
  // Track that we're now viewing an old session — next send will start fresh
  state.sessionId = sessionId;
  state.viewingOldSession = true;
  els.sessionLabel.textContent = "viewing old session";

  // Scroll the PDF to the anchor's page, then to the message
  const page = anchor.anchor_page || anchor.page;
  if (page) {
    await scrollToPage(page);
    pulseRect(anchor.anchor_rect || anchor.rect, page);
  }
  // Scroll the chat panel to the matching message
  if (targetMessageEl) {
    targetMessageEl.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

async function newSession() {
  if (state.abortController) state.abortController.abort();
  els.messages.innerHTML = "";
  state.historicalAnchors = [];
  state.viewingOldSession = false;
  if (state.pdfHash) {
    const r = await fetch("/api/session/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdf_hash: state.pdfHash }),
    });
    const d = await r.json();
    state.sessionId = d.session_id;
    els.sessionLabel.textContent = "new session";
    drawOverlay();
  }
}

// ---- Send chat ------------------------------------------------------
els.sendBtn.addEventListener("click", sendMessage);
els.composerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!els.sendBtn.disabled) sendMessage();
  }
});

async function sendMessage() {
  if (!state.pendingAnchor) return;
  const text = els.composerInput.value.trim();
  if (!text) return;

  // If we're viewing an old session, the first send after load must start a
  // fresh session — clear the loaded messages and create a new DB session.
  if (state.viewingOldSession) {
    state.viewingOldSession = false;
    els.messages.innerHTML = "";
    els.sessionLabel.textContent = "new session";
    try {
      const r = await fetch("/api/session/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdf_hash: state.pdfHash }),
      });
      const d = await r.json();
      state.sessionId = d.session_id;
    } catch (e) {
      alert("Failed to start a new session: " + e.message);
      return;
    }
  }
  if (!state.sessionId) return;

  // Lock
  els.composerInput.disabled = true;
  els.sendBtn.disabled = true;

  const messageId = uuid();
  const anchorSnapshot = { ...state.pendingAnchor };

  // Render user message
  appendMessage({
    id: messageId,
    role: "user",
    text,
    anchor_page: anchorSnapshot.page,
    anchor_rect: anchorSnapshot.rect,
    anchor_rotation: anchorSnapshot.rotation,
    thumbDataUrl: anchorSnapshot.thumbDataUrl,
    status: "complete",
  });

  // Capture rectangle image as base64 for the AI
  const rectImgB64 = await getRectImageBase64(anchorSnapshot.rect, anchorSnapshot.page);

  // Move pending to historical
  state.historicalAnchors.push({
    page: anchorSnapshot.page,
    rect: anchorSnapshot.rect,
    rotation: anchorSnapshot.rotation,
    messageId,
    thumbDataUrl: anchorSnapshot.thumbDataUrl,
  });
  clearPendingAnchor();
  els.composerInput.value = "";
  drawOverlay();

  // Render assistant placeholder
  const assistantEl = appendMessage({
    id: "a-" + messageId,
    role: "assistant",
    text: "",
    anchor_page: anchorSnapshot.page,
    anchor_rect: anchorSnapshot.rect,
    anchor_rotation: anchorSnapshot.rotation,
    thumbDataUrl: anchorSnapshot.thumbDataUrl,
    status: "streaming",
  });

  state.abortController = new AbortController();
  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: state.sessionId,
        message_id: messageId,
        text,
        anchor: {
          page: anchorSnapshot.page,
          rect: anchorSnapshot.rect,
          rotation: anchorSnapshot.rotation,
        },
      }),
      signal: state.abortController.signal,
    });
    if (!r.ok || !r.body) {
      const t = await r.text();
      assistantEl.querySelector(".body").textContent = `(error: ${t})`;
      assistantEl.classList.remove("streaming");
      assistantEl.dataset.status = "failed";
      return;
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let acc = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const eventBlock = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const lines = eventBlock.split("\n");
        let evType = "message";
        let dataStr = "";
        for (const line of lines) {
          if (line.startsWith("event:")) evType = line.slice(6).trim();
          else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
        }
        if (!dataStr) continue;
        let payload;
        try { payload = JSON.parse(dataStr); } catch { payload = dataStr; }
        if (evType === "token") {
          acc += payload;
          renderAssistantBody(assistantEl, acc);
          autoscroll();
        } else if (evType === "error") {
          assistantEl.querySelector(".body").textContent += `\n\n(error: ${payload})`;
          assistantEl.classList.remove("streaming");
          assistantEl.dataset.status = "failed";
        } else if (evType === "done") {
          assistantEl.classList.remove("streaming");
          assistantEl.dataset.status = "complete";
        }
      }
    }
  } catch (e) {
    if (e.name === "AbortError") {
      assistantEl.querySelector(".body").textContent += "\n(stopped)";
      assistantEl.classList.remove("streaming");
      assistantEl.dataset.status = "stopped";
    } else {
      assistantEl.querySelector(".body").textContent = `(error: ${e.message})`;
      assistantEl.classList.remove("streaming");
      assistantEl.dataset.status = "failed";
    }
  } finally {
    els.composerInput.disabled = false;
    state.abortController = null;
  }
}

async function getRectImageBase64(rect, pageNum) {
  // Render at 2x for clarity
  const entry = state.pages[pageNum];
  if (!entry || !entry.viewport) return null;
  const v = entry.viewport;
  const scale = 2.0;
  const w = Math.max(1, Math.round(rect.w * v.width * scale));
  const h = Math.max(1, Math.round(rect.h * v.height * scale));
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  const ctx = tmp.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    entry.canvas,
    Math.round(rect.x * entry.canvas.width),
    Math.round(rect.y * entry.canvas.height),
    Math.round(rect.w * entry.canvas.width),
    Math.round(rect.h * entry.canvas.height),
    0, 0, w, h
  );
  const dataUrl = tmp.toDataURL("image/png");
  return dataUrl.split(",")[1];
}

let _userPinnedToBottom = true;
let _lastScrollHeight = 0;

function autoscroll(force = false) {
  // Detect whether the user has scrolled up away from the bottom.
  // We measure against the *previous* scroll height, not the current one,
  // so a token update doesn't reset the pin state.
  const el = els.messages;
  const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  if (distFromBottom > 80) _userPinnedToBottom = false;
  if (force || _userPinnedToBottom) {
    el.scrollTop = el.scrollHeight;
    _userPinnedToBottom = true;
  }
  _lastScrollHeight = el.scrollHeight;
}

els.messages?.addEventListener("scroll", () => {
  const el = els.messages;
  const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  _userPinnedToBottom = distFromBottom < 80;
});

function appendMessage(m) {
  const div = document.createElement("div");
  div.className = `message ${m.role}` + (m.status === "streaming" ? " streaming" : "");
  div.dataset.id = m.id;
  div.dataset.status = m.status;
  if (m.session_id) div.dataset.sessionId = m.session_id;
  if (m.anchor_page) div.dataset.anchorPage = m.anchor_page;
  if (m.anchor_rect) div.dataset.anchorRect = JSON.stringify(m.anchor_rect);
  const chipHtml = (m.anchor_page && m.anchor_rect)
    ? `<div class="anchor-chip" data-page="${m.anchor_page}" data-rect='${JSON.stringify(m.anchor_rect)}'>
         <img src="${m.thumbDataUrl || ""}" alt="" />
         <span class="label">p. ${m.anchor_page}</span>
       </div>`
    : "";
  div.innerHTML = `
    <span class="role">${m.role}</span>
    ${chipHtml}
    <div class="body"></div>
  `;
  const body = div.querySelector(".body");
  if (m.text) {
    if (m.role === "assistant") {
      // Render as markdown (sync if CDN is ready, async via debounce if not)
      renderAssistantBody(div, m.text);
    } else {
      body.textContent = m.text;
    }
  }
  const chip = div.querySelector(".anchor-chip");
  if (chip) {
    chip.addEventListener("click", () => {
      const page = parseInt(chip.dataset.page, 10);
      const rect = JSON.parse(chip.dataset.rect);
      // Find the full anchor record for this message in our in-memory state
      const hit = (state.historicalAnchors || []).find(a =>
        a.page === page && a.rect && a.rect.x === rect.x && a.rect.y === rect.y
      );
      if (hit) {
        loadSessionForAnchor(hit);
      } else {
        // Fallback: just scroll + pulse
        state.currentPage = page;
        scrollToPage(page).then(() => pulseRect(rect, page));
      }
    });
  }
  els.messages.appendChild(div);
  autoscroll(true);
  return div;
}

function pulseRect(rect, pageNum) {
  // Briefly highlight the rectangle on the right page
  const entry = state.pages[pageNum];
  if (!entry || !entry.viewport) return;
  const ctx = entry.overlay.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  let alpha = 1;
  let frame = 0;
  function tick() {
    drawPageOverlay(pageNum);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = alpha;
    drawRect(ctx, rect, "pending", null, entry.viewport, true);
    ctx.restore();
    alpha -= 0.05;
    frame++;
    if (alpha > 0 && frame < 20) requestAnimationFrame(tick);
    else ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  tick();
}

// ---- Boot -----------------------------------------------------------
setupOverlayInteractions();
els.composerInput.addEventListener("input", () => {
  els.sendBtn.disabled = !(state.pendingAnchor && els.composerInput.value.trim());
});
