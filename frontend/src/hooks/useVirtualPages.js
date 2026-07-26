/**
 * Virtual page rendering. Renders only the pages in/near the viewport.
 *
 * Algorithm (matches v1.5):
 *  - Maintain a queue of pages that need rendering
 *  - Max N concurrent renders (PDF.js renders are CPU-heavy)
 *  - Keep at most BUDGET rendered pages in memory at any time
 *  - LRU-evict pages that scroll out of the viewport (free their canvas)
 *
 * The hook returns helpers and a `pages` map; the <Reader> component is
 * responsible for creating the DOM elements and passing them in.
 */

import { useEffect, useRef, useState } from "react";
import { getPdfJs } from "../lib/pdfjs";
import { estimatePageHeightCss } from "../lib/coords";

const BUFFER_PAGES = 5;
const MAX_RENDERED_PAGES = 11;
const MAX_CONCURRENT_RENDERS = 3;

// Module-private queue + active counter (one Reader instance).
let _activeRenders = 0;
const _queue = [];
const _tasksByPageNum = new Map();
// Tracks lastUsed timestamps synchronously (not in React state). React's
// setPages queues updates and pagesRef.current lags, so LRU eviction
// based on pagesRef alone can briefly exceed MAX when several renders
// complete in the same microtask. _lastUsedByPage is updated the moment
// a render finishes, so evictIfOverBudget has accurate recency info.
const _lastUsedByPage = new Map();

export function useVirtualPages({ pdfDoc, scale, scrollContainerRef, pageCount, onStatusChange }) {
    const [pages, setPages] = useState({});
    const pagesRef = useRef(pages);
    pagesRef.current = pages;
    const scaleRef = useRef(scale);
    scaleRef.current = scale;
    const pdfDocRef = useRef(pdfDoc);
    pdfDocRef.current = pdfDoc;

    function pagesInViewport() {
        const scroll = scrollContainerRef?.current;
        // No scroll container (single-page mode, or container not mounted yet):
        // there's effectively one page in view — return all currently
        // mounted wraps. The parent decides which wraps to render; we just
        // gate renders by viewport membership.
        if (!scroll) {
            return Object.keys(pagesRef.current)
                .map((n) => parseInt(n, 10))
                .filter((n) => Number.isFinite(n));
        }
        const top = scroll.scrollTop - 2000;
        const bottom = scroll.scrollTop + scroll.clientHeight + 2000;
        const pageH = estimatePageHeightCss(scaleRef.current);
        // Iterate the full page list (cheap — a 5000-page book is still
        // well under a millisecond for this loop). The earlier 40-page
        // cap blocked renders for page 41+.
        const result = [];
        for (let p = 1; p <= pageCount; p += 1) {
            const effectiveTop = (p - 1) * pageH;
            const effectiveH = pageH;
            if (effectiveTop + effectiveH >= top && effectiveTop <= bottom) {
                result.push(p);
            }
        }
        return result;
    }

    function scheduleRender(pageNum, canvas, overlay) {
        const entry = pagesRef.current[pageNum];
        if (!entry) return;
        if (entry.rendered && entry.renderedAt === scaleRef.current) return;
        if (entry.rendering) return;
        if (_queue.some((q) => q.pageNum === pageNum)) return;
        if (!pagesInViewportSet().has(pageNum)) return;
        // Don't push yet if pdfDoc isn't ready. The render fires later when
        // pdfDoc arrives via the [pdfDoc] effect's "render viewport" call.
        if (!pdfDocRef.current) return;
        _queue.push({ pageNum, canvas, overlay });
        setPageEntry(pageNum, { rendering: true });
        _drain();
    }

    // setPageEntry — records a page's wrap/canvas/overlay refs into the pages
    // map AND schedules a render retry for that page. Why we need the retry:
    // PageCanvas's mount effect calls setPageEntry(27) and then queueMicrotask
    // scheduleRender(27). The microtask fires before setPageEntry's commit, so
    // pagesRef.current[27] is still undefined and scheduleRender bails. The
    // [pdfDoc] effect's re-render loop is keyed on pdfDoc and only fires when
    // pdfDoc changes (initial load). For page changes triggered by anchor
    // clicks, pdfDoc doesn't change — so nobody retries. This deferred retry
    // is what closes that gap.
    function setPageEntry(pageNum, patch) {
        // Mutate pagesRef.current SYNCHRONOUSLY so the very next
        // scheduleRender call sees the new entry. setPages is called
        // separately to keep React's view in sync (soft-reset effect,
        // rendered set, etc. all read from React state).
        //
        // IMPORTANT: when a new canvas/overlay is registered (e.g. on
        // PageCanvas remount after a page change), we must invalidate the
        // `rendered` and `renderedAt` flags. Otherwise scheduleRender bails
        // on the early-return `if (entry.rendered && entry.renderedAt ===
        // scaleRef.current) return;` and the new canvas never gets drawn.
        const prev = pagesRef.current;
        const existing = prev[pageNum] || {};
        const hasNewCanvas = patch && (patch.canvas || patch.overlay || patch.wrap);
        const invalidated = hasNewCanvas
            ? { rendered: false, renderedAt: null, rendering: false }
            : {};
        const next = {
            ...prev,
            [pageNum]: { ...existing, ...invalidated, ...patch },
        };
        pagesRef.current = next;
        setPages(next);
        if (patch && patch.canvas && patch.overlay) {
            scheduleRender(pageNum, patch.canvas, patch.overlay);
        }
    }

    // Clear the rendering flag and re-queue. Used by _renderOne when the
    // scale changed during the render — the entry is left with
    // rendering: true from setPageEntry's queueing call, which would
    // block any re-queue. Mutates pagesRef.current synchronously so the
    // very next scheduleRender call (in a microtask) sees rendering: false.
    function _clearRenderingAndRequeue(pageNum, canvas, overlay) {
        const prev = pagesRef.current;
        if (!prev[pageNum]) return;
        const next = { ...prev, [pageNum]: { ...prev[pageNum], rendering: false } };
        pagesRef.current = next;
        setPages(next);
        queueMicrotask(() => scheduleRender(pageNum, canvas, overlay));
    }

    // Schedule an eviction to happen microtask-from-now. Multiple renders
    // finishing in the same frame otherwise grow the rendered count past
    // MAX before any single evict passes see the latest state.
    let _evictQueued = false;
    function _evictSoon() {
        if (_evictQueued) return;
        _evictQueued = true;
        queueMicrotask(() => {
            _evictQueued = false;
            evictIfOverBudget();
        });
    }

    const _viewportSetRef = useRef(new Set());
    function pagesInViewportSet() {
        const set = _viewportSetRef.current;
        const current = pagesInViewport();
        if (set.size !== current.length || !current.every((p) => set.has(p))) {
            set.clear();
            for (const p of current) set.add(p);
        }
        return set;
    }

    /**
     * LRU eviction. When rendered > MAX, drop oldest entries (by lastUsed).
     * Viewport pages are protected. Each eviction frees the canvas backing
     * store (canvas.width = 0) and cancels any in-flight render task.
     */
    function evictIfOverBudget() {
        const viewport = pagesInViewportSet();
        // Sort ALL known rendered pages by their synchronous lastUsed
        // (from _lastUsedByPage), not pagesRef.current.lastUsed which
        // may be stale if React state hasn't flushed.
        const allKnown = Array.from(_lastUsedByPage.keys());
        if (allKnown.length <= MAX_RENDERED_PAGES) return;
        allKnown.sort((a, b) => _lastUsedByPage.get(a) - _lastUsedByPage.get(b));
        const toEvict = allKnown.length - MAX_RENDERED_PAGES;
        const evictIds = [];
        for (const p of allKnown) {
            if (evictIds.length >= toEvict) break;
            if (viewport.has(p)) continue;
            evictIds.push(p);
        }
        if (evictIds.length === 0) return;
        // Apply eviction to React state + clean canvas + cancel task.
        setPages((prev) => {
            const next = { ...prev };
            for (const id of evictIds) {
                const entry = next[id];
                if (entry?.canvas) entry.canvas.width = 0;
                const task = _tasksByPageNum.get(id);
                if (task) {
                    try { task.cancel(); } catch { /* ignore */ }
                    _tasksByPageNum.delete(id);
                }
                delete next[id];
                _lastUsedByPage.delete(id);
            }
            return next;
        });
    }

    function _drain() {
        while (_activeRenders < MAX_CONCURRENT_RENDERS && _queue.length > 0) {
            const job = _queue.shift();
            _activeRenders += 1;
            _renderOne(job, scaleRef, pagesRef, setPages, onStatusChange, _evictSoon, pdfDocRef, _clearRenderingAndRequeue)
                .finally(() => {
                    _activeRenders -= 1;
                    _drain();
                });
        }
    }

    useEffect(() => {
        if (!pdfDoc || !scrollContainerRef?.current) return undefined;
        const scroll = scrollContainerRef.current;
        let lastTop = -1;
        let debounceTimer = null;
        function handler() {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                const newTop = scroll.scrollTop;
                if (newTop === lastTop) return;
                lastTop = newTop;
                for (const p of pagesInViewport()) {
                    const entry = pagesRef.current[p];
                    if (entry?.canvas && entry?.overlay) {
                        scheduleRender(p, entry.canvas, entry.overlay);
                    }
                }
                evictIfOverBudget();
            }, 80);
        }
        scroll.addEventListener("scroll", handler, { passive: true });
        return () => {
            scroll.removeEventListener("scroll", handler);
            if (debounceTimer) clearTimeout(debounceTimer);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pdfDoc, scrollContainerRef, pageCount]);

    // Cancel all in-flight tasks + invalidate render cache when the PDF changes.
    // IMPORTANT: preserve the canvas/overlay refs in each entry. They were
    // registered by PageCanvas's mount effect, which runs BEFORE this effect
    // in React's commit phase. If we did setPages({}) here, every later
    // scheduleRender() would see entry=undefined and bail out — pages would
    // never render. Instead, mark every entry as not-yet-rendered-at-this-doc
    // so it gets re-rendered on the next schedule call.
    useEffect(() => {
        for (const task of _tasksByPageNum.values()) {
            try { task.cancel(); } catch { /* ignore */ }
        }
        _tasksByPageNum.clear();
        _lastUsedByPage.clear();
        setPages((prev) => {
            const next = {};
            for (const k of Object.keys(prev)) {
                next[k] = { ...prev[k], rendered: false, renderedAt: null };
            }
            return next;
        });
        // pdfDoc just became available. PageCanvas's mount effect already
        // called scheduleRender (which was a no-op because pdfDocRef.current
        // was null). Now retry those renders for every viewport page.
        if (pdfDoc) {
            // Wait one microtask so setPages has flushed and pagesRef is current.
            queueMicrotask(() => {
                for (const p of pagesInViewport()) {
                    const entry = pagesRef.current[p];
                    if (entry?.canvas && entry?.overlay) {
                        scheduleRender(p, entry.canvas, entry.overlay);
                    }
                }
            });
        }
    }, [pdfDoc]);

    // When the scale changes (zoom dropdown, fit-width recompute, window
    // resize with fit-width), the canvas needs a fresh render at the new
    // scale. scheduleRender's early-return compares entry.renderedAt to
    // scaleRef.current so it bails correctly when nothing changed, and
    // re-runs when scaleRef.current moves.
    useEffect(() => {
        if (!pdfDoc) return;
        // Defer so the latest scaleRef.current is committed by React.
        queueMicrotask(() => {
            for (const p of pagesInViewport()) {
                const entry = pagesRef.current[p];
                if (entry?.canvas && entry?.overlay) {
                    scheduleRender(p, entry.canvas, entry.overlay);
                }
            }
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pdfDoc, scale]);

    return { pages, setPageEntry, scheduleRender, pagesInViewport };
}

async function _renderOne(job, scaleRef, pagesRef, setPages, onStatusChange, evictIfOverBudget_soon, pdfDocRef, clearRenderingAndRequeue) {
    const { pageNum, canvas, overlay } = job;
    const scale = scaleRef.current;
    const pdfDoc = pdfDocRef.current;
    try {
        const pdfjs = await getPdfJs();
        if (!pdfDoc) throw new Error("no pdfDoc");
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale, rotation: 0 });
        const dpr = window.devicePixelRatio || 1;
        canvas.width = viewport.width * dpr;
        canvas.height = viewport.height * dpr;
        canvas.style.width = viewport.width + "px";
        canvas.style.height = viewport.height + "px";
        overlay.width = canvas.width;
        overlay.height = canvas.height;
        overlay.style.width = canvas.style.width;
        overlay.style.height = canvas.style.height;
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const task = page.render({ canvasContext: ctx, viewport });
        _tasksByPageNum.set(pageNum, task);
        try {
            await task.promise;
        } catch (err) {
            if (err?.name === "RenderingCancelledException") return;
            throw err;
        } finally {
            _tasksByPageNum.delete(pageNum);
        }
        if (scaleRef.current !== scale) {
            // Scale changed while we were rendering. The canvas is now sized
            // for the old scale (which we just overwrote) and the entry
            // is left with rendering: true from setPageEntry, blocking
            // future re-queues. Clear the flag and re-queue at the new
            // scale. We don't undo the canvas.width/height here because
            // the next render will overwrite them.
            if (clearRenderingAndRequeue) {
                clearRenderingAndRequeue(pageNum, canvas, overlay);
            }
            return;
        }
        // Update sync timestamp BEFORE setPages — needed by evictIfOverBudget
        // which reads _lastUsedByPage in microtasks after this render lands.
        _lastUsedByPage.set(pageNum, Date.now());
        setPages((prev) => ({
            ...prev,
            [pageNum]: {
                ...(prev[pageNum] || {}),
                viewport,
                rendered: true,
                renderedAt: scale,
                rendering: false,
                lastUsed: Date.now(),
            },
        }));
        if (onStatusChange) {
            const renderedCount = Object.values(pagesRef.current).filter((e) => e.rendered).length;
            onStatusChange({ rendered: renderedCount, total: pdfDoc.numPages });
        }
        // Defer eviction so concurrent renders finishing in the same
        // task don't each see a snapshot of pagesRef.current pre-eviction.
        if (evictIfOverBudget_soon) evictIfOverBudget_soon();
        else evictIfOverBudget();
    } catch (err) {
        console.error("[useVirtualPages] render failed for page", pageNum, err);
        setPages((prev) => ({
            ...prev,
            [pageNum]: { ...(prev[pageNum] || {}), rendering: false, rendered: false },
        }));
    }
}