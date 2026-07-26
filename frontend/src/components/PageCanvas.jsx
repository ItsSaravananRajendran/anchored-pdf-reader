/**
 * PageCanvas — one PDF page, with canvas + overlay.
 * Imperative PDF.js render is driven by useVirtualPages in the parent.
 */

import { useEffect, useRef } from "react";
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
        return () => {
            // Don't evict the entry — virtual-pages handles that
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pageNum]);

    // Draw the live drag rect on the overlay
    useEffect(() => {
        if (!overlayRef.current) return;
        const ctx = overlayRef.current.getContext("2d");
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
        const rect = drag.currentDragRect();
        if (rect) {
            ctx.strokeStyle = "rgba(88,166,255,0.95)";
            ctx.fillStyle = "rgba(88,166,255,0.18)";
            ctx.lineWidth = 2;
            ctx.fillRect(
                rect.x * width, rect.y * width * (width > 0 ? (pageEntry?.viewport?.height || 0) / width : 1),
                rect.w * width,
                rect.h * width * (width > 0 ? (pageEntry?.viewport?.height || 0) / width : 1),
            );
        }
    });

    // Draw historical anchors on the overlay (only when rendered, not mid-drag)
    useEffect(() => {
        if (!overlayRef.current) return;
        if (drag.currentDragRect()) return;
        const ctx = overlayRef.current.getContext("2d");
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
        const rects = historicalAnchors.filter((a) => a.anchor_page === pageNum);
        for (const a of rects) {
            const r = a.anchor_rect;
            ctx.strokeStyle = a.role === "user" ? "rgba(210,153,34,0.85)" : "rgba(63,185,80,0.85)";
            ctx.fillStyle = a.role === "user" ? "rgba(210,153,34,0.10)" : "rgba(63,185,80,0.08)";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 3]);
            const x = r.x * width;
            const y = r.y * (pageEntry?.viewport?.height || 0);
            const w = r.w * width;
            const h = r.h * (pageEntry?.viewport?.height || 0);
            ctx.fillRect(x, y, w, h);
            ctx.strokeRect(x, y, w, h);
            ctx.setLineDash([]);
        }
    }, [historicalAnchors, pageNum, width, pageEntry]);

    return (
        <div ref={wrapRef} className="pdf-page-wrap" data-page={pageNum} style={{ width }}>
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