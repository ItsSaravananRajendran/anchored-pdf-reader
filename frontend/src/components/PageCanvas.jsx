/**
 * PageCanvas — one PDF page, with canvas + overlay.
 * Imperative PDF.js render is driven by useVirtualPages in the parent.
 *
 * Layout: the wrap div reserves its expected height via the --wrap-h /
 * --wrap-w CSS variables so the scroll container has the right
 * scrollHeight before the page actually renders.
 *
 * Render-once-and-scale strategy:
 *   The page bitmap is rendered once at a fixed sourceScale (a constant
 *   high-resolution value, e.g. 2.0). Zoom changes are applied via CSS
 *   `transform: scale(displayScale / sourceScale)` on the canvas, which
 *   is GPU-composited and free — no PDF.js re-render. Wrap dimensions
 *   (--wrap-w / --wrap-h) follow displayScale so the scrollbar stays
 *   correct. The overlay canvas is rendered at the displayScale size
 *   (not the sourceScale size) so drag rects and anchor highlights
 *   stay aligned with the visible page under any zoom level.
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
    displayScale,
    sourceScale,
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
    // `naturalH` is the same for the height (Letter is 792pt). The bitmap is
    // rasterized at sourceScale (a constant — the highest quality we'll display).
    // The visible canvas size = sourceSize * (displayScale / sourceScale) — i.e.
    // when displayScale < sourceScale, the bitmap is downscaled by the browser
    // (GPU-composited, free); when displayScale > sourceScale, the bitmap is
    // upscaled (still GPU-composited, slight blur). Wrap dimensions follow
    // displayScale so the scrollbar positions correctly.
    const naturalH = width * (792 / 612);
    const height = pageEntry?.viewport?.height ? pageEntry.viewport.height / sourceScale : naturalH;
    // Wrap dimensions (used for layout / scrollbar).
    const W = width * displayScale;
    const H = height * displayScale;
    // Canvas bitmap dimensions — rendered at sourceScale, displayed at the
    // wrap's display size. The browser handles the scale factor.
    const bitmapW = width * sourceScale;
    const bitmapH = height * sourceScale;

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
            ctx.lineWidth = 1.5 * sourceScale;
            ctx.setLineDash([6 * sourceScale, 3 * sourceScale]);
            ctx.fillRect(r.x * bitmapW, r.y * bitmapH, r.w * bitmapW, r.h * bitmapH);
            ctx.strokeRect(r.x * bitmapW, r.y * bitmapH, r.w * bitmapW, r.h * bitmapH);
            ctx.setLineDash([]);
        }
    }, [pageAnchors, bitmapW, bitmapH, sourceScale, pageEntry]);

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
                ctx.lineWidth = 2 * sourceScale;
                ctx.fillRect(rect.x * bitmapW, rect.y * bitmapH, rect.w * bitmapW, rect.h * bitmapH);
                ctx.strokeRect(rect.x * bitmapW, rect.y * bitmapH, rect.w * bitmapW, rect.h * bitmapH);
            }
        });
        return unsubscribe;
    }, [bitmapW, bitmapH, sourceScale, drag]);

    const wrapStyle = {
        "--wrap-w": W + "px",
        "--wrap-h": H + "px",
    };
    // Canvas fills the wrap's display dimensions. The bitmap is rasterized
    // at sourceScale (canvas.width/height = sourceW/H, set by _renderOne),
    // but the CSS width/height is 100% of the wrap, so the bitmap is
    // scaled to fit by the browser (GPU-accelerated, free). No CSS
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
