/**
 * PageCanvas — one PDF page, with canvas + overlay.
 * Imperative PDF.js render is driven by useVirtualPages in the parent.
 *
 * Layout: the wrap div reserves its expected height via the --wrap-h /
 * --wrap-w CSS variables so the scroll container has the right
 * scrollHeight before the page actually renders.
 *
 * Render strategy:
 *   The page bitmap is rendered at displayScale × RENDER_DPR (matching
 *   what useVirtualPages does), so bitmap pixels are ≥ display pixels
 *   and the browser just copies them at native resolution — no upscale,
 *   sharp text on HiDPI displays. Zoom changes invalidate the cache in
 *   useVirtualPages and re-render at the new displayScale. Wrap
 *   dimensions follow displayScale so the scrollbar positions correctly.
 *   The overlay canvas matches the page canvas bitmap dimensions, so
 *   drag rects and anchor highlights stay aligned with the visible page
 *   under any zoom level.
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

// Multiplier applied to displayScale when rasterizing the page bitmap.
// 1.5 is the sweet spot: text is sharp at any zoom (bitmap >= display
// pixels), and a 1.5× upscale of a typical 800pt page is ~2 MB of
// bitmap memory — acceptable for a virtualized 11-page cache. HiDPI
// displays get extra sharpness; 1× displays still see bitmap pixels
// at ≥ display resolution so the browser just copies them down.
const RENDER_DPR = 1.5;

export default function PageCanvas({
    pageNum,
    width,
    displayScale,
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

    // `width` is the natural CSS width at scale=1.0 (612pt * 96/72 = 816 for Letter).
    // The bitmap is rasterized at displayScale × RENDER_DPR by useVirtualPages;
    // PageCanvas just sizes its overlay to match. Wrap dimensions follow
    // displayScale so the scrollbar positions correctly. Bitmap >= display,
    // so the browser just copies pixels at native resolution — sharp text
    // on HiDPI displays without the upscale blur of a fixed-source-scale render.
    const naturalH = width * (792 / 612);
    // Wrap dimensions (used for layout / scrollbar).
    const W = width * displayScale;
    const H = naturalH * displayScale;
    // Canvas bitmap dimensions — overlay matches the page canvas bitmap.
    const bitmapW = width * displayScale * RENDER_DPR;
    const bitmapH = naturalH * displayScale * RENDER_DPR;

    // Resize the overlay canvas to match the PAGE canvas bitmap dimensions
    // (not the display dimensions). Overlay bitmap coords == page canvas
    // bitmap coords, so drawing in `rect.x * bitmapW` lands in the same
    // place as the page content. The overlay's CSS size is set to match
    // the wrap (100%), so the bitmap is scaled to display by the browser
    // in lockstep with the page canvas.
    useEffect(() => {
        const overlay = overlayRef.current;
        if (!overlay) return;
        const tw = Math.round(bitmapW);
        const th = Math.round(bitmapH);
        if (overlay.width !== tw || overlay.height !== th) {
            overlay.width = tw;
            overlay.height = th;
            // CSS size is 100% of wrap (set via JSX style below).
        }
    }, [bitmapW, bitmapH]);

    // Memoized filter — only re-runs when historicalAnchors or pageNum changes.
    const pageAnchors = useMemo(
        () => historicalAnchors.filter((a) => a.anchor_page === pageNum),
        [historicalAnchors, pageNum],
    );

    // Draw historical anchors. Overlay bitmap == page canvas bitmap, so
    // rect coords are fractions of bitmap dimensions — they land in the
    // same pixel positions as the page content (the browser scales both
    // bitmaps to display dims in lockstep).
    useEffect(() => {
        const overlay = overlayRef.current;
        if (!overlay || !pageEntry?.viewport) return;
        if (pageAnchors.length === 0) return;
        const ctx = overlay.getContext("2d");
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, bitmapW, bitmapH);
        for (const a of pageAnchors) {
            const r = a.anchor_rect;
            ctx.strokeStyle = a.role === "user" ? "rgba(210,153,34,0.85)" : "rgba(63,185,80,0.85)";
            ctx.fillStyle = a.role === "user" ? "rgba(210,153,34,0.10)" : "rgba(63,185,80,0.08)";
            ctx.lineWidth = 1.5 * RENDER_DPR;
            ctx.setLineDash([6 * RENDER_DPR, 3 * RENDER_DPR]);
            ctx.fillRect(r.x * bitmapW, r.y * bitmapH, r.w * bitmapW, r.h * bitmapH);
            ctx.strokeRect(r.x * bitmapW, r.y * bitmapH, r.w * bitmapW, r.h * bitmapH);
            ctx.setLineDash([]);
        }
    }, [pageAnchors, bitmapW, bitmapH, RENDER_DPR, pageEntry]);

    // Live drag rectangle. Subscribe to drag changes — fires only when
    // the rect actually moves (no rAF polling, no per-render redraws).
    useEffect(() => {
        const overlay = overlayRef.current;
        if (!overlay) return undefined;
        const ctx = overlay.getContext("2d");
        const unsubscribe = drag.subscribe((rect) => {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, bitmapW, bitmapH);
            if (rect) {
                ctx.strokeStyle = "rgba(88,166,255,0.95)";
                ctx.fillStyle = "rgba(88,166,255,0.18)";
                ctx.lineWidth = 2 * RENDER_DPR;
                ctx.fillRect(rect.x * bitmapW, rect.y * bitmapH, rect.w * bitmapW, rect.h * bitmapH);
                ctx.strokeRect(rect.x * bitmapW, rect.y * bitmapH, rect.w * bitmapW, rect.h * bitmapH);
            }
        });
        return unsubscribe;
    }, [bitmapW, bitmapH, RENDER_DPR, drag]);

    const wrapStyle = {
        "--wrap-w": W + "px",
        "--wrap-h": H + "px",
    };
    // Canvas fills the wrap's display dimensions. The bitmap is rasterized
    // at displayScale × RENDER_DPR by _renderOne, but the CSS width/height
    // is 100% of the wrap, so the browser copies the bitmap pixels to the
    // display size (free, GPU-accelerated). No CSS
    // transform needed — that approach breaks layout because transform
    // doesn't affect the element's layout box.
    const canvasStyle = {
        width: "100%",
        height: "100%",
        display: "block",
    };

    return (
        <div
            ref={wrapRef}
            className="pdf-page-wrap"
            data-page={pageNum}
            style={wrapStyle}
        >
            <canvas ref={canvasRef} className="pdf-page-canvas" style={canvasStyle} />
            <canvas
                ref={overlayRef}
                className="pdf-page-overlay"
                style={canvasStyle}
                onPointerDown={drag.onPointerDown}
                onPointerMove={drag.onPointerMove}
                onPointerUp={drag.onPointerUp}
            />
        </div>
    );
}
