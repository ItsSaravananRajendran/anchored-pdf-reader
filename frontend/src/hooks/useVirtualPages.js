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

export function useVirtualPages({ pdfDoc, scale, scrollContainerRef, pageCount, onStatusChange }) {
    const [pages, setPages] = useState({});
    const pagesRef = useRef(pages);
    pagesRef.current = pages;
    const scaleRef = useRef(scale);
    scaleRef.current = scale;
    const pdfDocRef = useRef(pdfDoc);
    pdfDocRef.current = pdfDoc;

    function setPageEntry(pageNum, patch) {
        setPages((prev) => ({
            ...prev,
            [pageNum]: { ...(prev[pageNum] || {}), ...patch },
        }));
    }

    function pagesInViewport() {
        const scroll = scrollContainerRef?.current;
        if (!scroll) return [];
        const top = scroll.scrollTop - 2000;
        const bottom = scroll.scrollTop + scroll.clientHeight + 2000;
        const pageH = estimatePageHeightCss(scaleRef.current);
        const maxP = Math.min(pageCount, 40);
        const result = [];
        for (let p = 1; p <= maxP; p += 1) {
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
        _queue.push({ pageNum, canvas, overlay, pdfDoc: pdfDocRef.current });
        setPageEntry(pageNum, { rendering: true });
        _drain();
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
        const entries = Object.entries(pagesRef.current);
        const rendered = entries.filter(([, e]) => e.rendered);
        if (rendered.length <= MAX_RENDERED_PAGES) return;
        rendered.sort(([, a], [, b]) => (a.lastUsed || 0) - (b.lastUsed || 0));
        const toEvict = rendered.length - MAX_RENDERED_PAGES;
        const evictIds = [];
        for (const [pageNum, entry] of rendered) {
            if (evictIds.length >= toEvict) break;
            if (viewport.has(Number(pageNum))) continue;
            const task = _tasksByPageNum.get(Number(pageNum));
            if (task) {
                try { task.cancel(); } catch { /* ignore */ }
                _tasksByPageNum.delete(Number(pageNum));
            }
            if (entry.canvas) entry.canvas.width = 0;
            evictIds.push(pageNum);
        }
        if (evictIds.length > 0) {
            setPages((prev) => {
                const next = { ...prev };
                for (const id of evictIds) delete next[id];
                return next;
            });
        }
    }

    function _drain() {
        while (_activeRenders < MAX_CONCURRENT_RENDERS && _queue.length > 0) {
            const job = _queue.shift();
            _activeRenders += 1;
            _renderOne(job, scaleRef, pagesRef, setPages, onStatusChange, evictIfOverBudget)
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

    // Cancel all in-flight tasks + reset pages when the PDF changes.
    useEffect(() => {
        for (const task of _tasksByPageNum.values()) {
            try { task.cancel(); } catch { /* ignore */ }
        }
        _tasksByPageNum.clear();
        setPages({});
    }, [pdfDoc]);

    return { pages, setPageEntry, scheduleRender, pagesInViewport };
}

async function _renderOne(job, scaleRef, pagesRef, setPages, onStatusChange, evictIfOverBudget) {
    const { pageNum, canvas, overlay, pdfDoc } = job;
    const scale = scaleRef.current;
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
        if (scaleRef.current !== scale) return;
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
        evictIfOverBudget();
    } catch (err) {
        console.error("[useVirtualPages] render failed for page", pageNum, err);
        setPages((prev) => ({
            ...prev,
            [pageNum]: { ...(prev[pageNum] || {}), rendering: false, rendered: false },
        }));
    }
}