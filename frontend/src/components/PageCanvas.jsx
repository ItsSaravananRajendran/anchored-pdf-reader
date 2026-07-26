/**
 * PageCanvas — one PDF page, with canvas + overlay.
 * Imperative PDF.js render is driven by useVirtualPages in the parent.
 *
 * Layout: the wrap div has a fixed CSS pixel height set via the --wrap-h
 * CSS variable so the scroll container has the right scrollHeight before
 * the page actually renders. The canvas inside uses the PDF.js viewport
 * to get its real width/height.
 */

import { useEffect, useRef } from "react";
import { useDragSelection } from "../hooks/useDragSelection";
import { estimatePageHeightCss } from "../lib/coords";

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

    // When this element mounts, register it with the virtual-pages hook
    useEffect(() => {
        const canvas = canvasRef.current;
        const overlay = overlayRef.current;
        const wrap = wrapRef.current;
        setPageEntry(pageNum, { wrap, canvas, overlay });
        // Defer scheduleRender to the next microtask. The setPageEntry above
        // is batched with the parent hook's [pdfDoc] reset; calling
        // scheduleRender synchronously here would read pagesRef.current BEFORE
        // React commits our setPageEntry, so entry would be undefined and
        // the render would be silently dropped.
        queueMicrotask(() => scheduleRender(pageNum, canvas, overlay));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pageNum]);

    // Compute the CSS height used for the wrap's reserved space. Once the
    // PDF.js viewport arrives we switch to its exact height; otherwise we
    // estimate from the natural page aspect ratio.
    const naturalH = width * (792 / 612); // Letter aspect ratio fallback
    const height = pageEntry?.viewport?.height || naturalH;

    // Redraw the overlay whenever the live drag rect OR the rendered
    // viewport changes (the height in particular — the overlay canvas is
    // sized to viewport.height * dpr once a page renders, and the dashed
    // historical anchors need correct coordinates).
    useEffect(() => {
        const overlay = overlayRef.current;
        if (!overlay || !width || !height) return;
        const dpr = window.devicePixelRatio || 1;
        const W = pageEntry?.viewport?.width || width;
        const H = pageEntry?.viewport?.height || height;
        if (overlay.width !== Math.round(W * dpr) || overlay.height !== Math.round(H * dpr)) {
            overlay.width = Math.round(W * dpr);
            overlay.height = Math.round(H * dpr);
            overlay.style.width = W + "px";
            overlay.style.height = H + "px";
        }
        const ctx = overlay.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        const rect = drag.currentDragRect();
        if (rect) {
            ctx.strokeStyle = "rgba(88,166,255,0.95)";
            ctx.fillStyle = "rgba(88,166,255,0.18)";
            ctx.lineWidth = 2;
            ctx.fillRect(rect.x * W, rect.y * H, rect.w * W, rect.h * H);
            ctx.strokeRect(rect.x * W, rect.y * H, rect.w * W, rect.h * H);
        }
    });

    // Draw historical anchors on the overlay (only when no live drag is happening)
    useEffect(() => {
        const overlay = overlayRef.current;
        if (!overlay || !width || drag.currentDragRect()) return;
        const dpr = window.devicePixelRatio || 1;
        const W = pageEntry?.viewport?.width || width;
        const H = pageEntry?.viewport?.height || height;
        const ctx = overlay.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        const rects = historicalAnchors.filter((a) => a.anchor_page === pageNum);
        for (const a of rects) {
            const r = a.anchor_rect;
            ctx.strokeStyle = a.role === "user" ? "rgba(210,153,34,0.85)" : "rgba(63,185,80,0.85)";
            ctx.fillStyle = a.role === "user" ? "rgba(210,153,34,0.10)" : "rgba(63,185,80,0.08)";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 3]);
            ctx.fillRect(r.x * W, r.y * H, r.w * W, r.h * H);
            ctx.strokeRect(r.x * W, r.y * H, r.w * W, r.h * H);
            ctx.setLineDash([]);
        }
    }, [historicalAnchors, pageNum, width, height, pageEntry, drag]);

    // Layout: reserve the right height via CSS variables so the scroll
    // container has the correct scrollHeight even before this page renders.
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