/**
 * PageCanvas — one PDF page, with canvas + overlay.
 * Imperative PDF.js render is driven by useVirtualPages in the parent.
 *
 * Layout: the wrap div reserves its expected height via the --wrap-h /
 * --wrap-w CSS variables so the scroll container has the right
 * scrollHeight before the page actually renders.
 *
 * Performance notes:
 *  - Each wrap in the DOM keeps two canvases alive (page + overlay).
 *    For a 500-page book that's 1000 canvases total. Most wraps don't
 *    have a rendered canvas bitmap — only ~11 ever do.
 *  - The historical-anchors and live-drag overlays are event-driven
 *    (no rAF polling). They only do work when something changes.
 *  - All effects here have explicit dependency arrays so a parent
 *    re-render doesn't refire them across all 500 wraps.
 */

import { useEffect, useMemo, useRef } from "react";
import { useDragSelection } from "../hooks/useDragSelection";

export default function PageCanvas({
    pageNum,
    width,
    pageEntry,
    setPageEntry,
    scheduleRender,
    onCommitRect,
    onClickAnchor,
    historicalAnchors,
}) {
    const wrapRef = useRef(null);
    const canvasRef = useRef(null);
    const overlayRef = useRef(null);

    const drag = useDragSelection({
        onCommit: onCommitRect ? (rect) => onCommitRect(rect, pageNum) : undefined,
        onClick: onClickAnchor,
        historicalAnchors,
    });

    // On mount, register with virtual-pages + schedule initial render.
    useEffect(() => {
        const canvas = canvasRef.current;
        const overlay = overlayRef.current;
        const wrap = wrapRef.current;
        setPageEntry(pageNum, { wrap, canvas, overlay });
        queueMicrotask(() => scheduleRender(pageNum, canvas, overlay));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pageNum]);

    const naturalH = width * (792 / 612); // Letter aspect ratio fallback
    const height = pageEntry?.viewport?.height || naturalH;
    const W = pageEntry?.viewport?.width || width;
    const H = pageEntry?.viewport?.height || height;

    // Resize the overlay canvas to match the rendered viewport. Only runs
    // when size changes (not on every render).
    useEffect(() => {
        const overlay = overlayRef.current;
        if (!overlay) return;
        // DPR is fixed at 1 in _renderOne (see useVirtualPages). Mirror that
        // here so the overlay bitmap matches the page bitmap pixel-for-pixel.
        const dpr = 1;
        const tw = Math.round(W * dpr);
        const th = Math.round(H * dpr);
        if (overlay.width !== tw || overlay.height !== th) {
            overlay.width = tw;
            overlay.height = th;
            overlay.style.width = W + "px";
            overlay.style.height = H + "px";
        }
    }, [W, H]);

    // Memoized filter — only re-runs when historicalAnchors or pageNum changes.
    const pageAnchors = useMemo(
        () => historicalAnchors.filter((a) => a.anchor_page === pageNum),
        [historicalAnchors, pageNum],
    );

    // Draw historical anchors. Skips entirely if:
    //  - overlay not ready
    //  - no live drag in progress (drag effect owns the overlay then)
    //  - page hasn't rendered (we have no exact viewport to scale into)
    //  - page has no anchors (the common case)
    useEffect(() => {
        const overlay = overlayRef.current;
        if (!overlay || !pageEntry?.viewport) return;
        if (pageAnchors.length === 0) return;
        const ctx = overlay.getContext("2d");
        // Overlay bitmap is rendered at DPR=1 (see _renderOne in useVirtualPages).
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, W, H);
        for (const a of pageAnchors) {
            const r = a.anchor_rect;
            ctx.strokeStyle = a.role === "user" ? "rgba(210,153,34,0.85)" : "rgba(63,185,80,0.85)";
            ctx.fillStyle = a.role === "user" ? "rgba(210,153,34,0.10)" : "rgba(63,185,80,0.08)";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 3]);
            ctx.fillRect(r.x * W, r.y * H, r.w * W, r.h * H);
            ctx.strokeRect(r.x * W, r.y * H, r.w * W, r.h * H);
            ctx.setLineDash([]);
        }
    }, [pageAnchors, W, H, pageEntry]);

    // Live drag rectangle. Subscribe to drag changes — fires only when
    // the rect actually moves (no rAF polling, no per-render redraws).
    useEffect(() => {
        const overlay = overlayRef.current;
        if (!overlay) return undefined;
        const ctx = overlay.getContext("2d");
        const unsubscribe = drag.subscribe((rect) => {
            // DPR=1 (see _renderOne in useVirtualPages).
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, W, H);
            if (rect) {
                ctx.strokeStyle = "rgba(88,166,255,0.95)";
                ctx.fillStyle = "rgba(88,166,255,0.18)";
                ctx.lineWidth = 2;
                ctx.fillRect(rect.x * W, rect.y * H, rect.w * W, rect.h * H);
                ctx.strokeRect(rect.x * W, rect.y * H, rect.w * W, rect.h * H);
            }
        });
        return unsubscribe;
    }, [W, H, drag]);

    const wrapStyle = {
        "--wrap-w": width + "px",
        "--wrap-h": height + "px",
    };

    return (
        <div
            ref={wrapRef}
            className="pdf-page-wrap"
            data-page={pageNum}
            style={wrapStyle}
        >
            <canvas ref={canvasRef} className="pdf-page-canvas" />
            <canvas
                ref={overlayRef}
                className="pdf-page-overlay"
                onPointerDown={drag.onPointerDown}
                onPointerMove={drag.onPointerMove}
                onPointerUp={drag.onPointerUp}
            />
        </div>
    );
}