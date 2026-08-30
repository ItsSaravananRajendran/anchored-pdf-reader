/**
 * useFitWidthScale — recompute the scale for "fit width" mode.
 *
 * Returns the current effective scale given the zoomMode and PDF doc.
 * When zoomMode is "fit-width", picks the scale that fills the container
 * minus 32px of padding. Otherwise returns the numeric value.
 */

import { useEffect, useState } from "react";

export function useFitWidthScale({ zoomMode, pdfDoc, scrollContainerRef }) {
    const [scale, setScale] = useState(1.0);

    useEffect(() => {
        let cancelled = false;
        let resizeObserver = null;
        let rafHandles = [];

        async function compute() {
            if (zoomMode === "fit-width") {
                if (!pdfDoc || !scrollContainerRef.current) return;
                const page = await pdfDoc.getPage(1);
                if (cancelled) return;
                const v = page.getViewport({ scale: 1.0 });
                // Subtract the reader-scroll padding (24+24 vertical, 16+16 horizontal)
                // so the page fits inside the visible content area, not under the
                // scrollbar / padding.
                const cw = (scrollContainerRef.current.clientWidth || 800) - 32;
                if (!cancelled) setScale(Math.max(0.25, cw / v.width));
            } else if (!cancelled) {
                setScale(parseFloat(zoomMode) || 1.0);
            }
        }

        // Wait for two rAFs after mount before measuring the scroll container.
        // One frame is sometimes not enough — React's first commit paints
        // synchronously, but grid/flex column widths can settle a frame
        // later on Safari/Firefox. Two rAFs guarantees the layout is stable
        // before we read clientWidth. Without this, the first fit-width
        // scale was computed against a pre-layout width and produced a
        // ~0.8× scale instead of ~2× — every page then had to be cancelled
        // and re-rendered.
        function startObserve() {
            if (zoomMode === "fit-width" && scrollContainerRef.current) {
                resizeObserver = new ResizeObserver(() => {
                    if (!cancelled) compute();
                });
                resizeObserver.observe(scrollContainerRef.current);
            }
        }
        rafHandles.push(requestAnimationFrame(() => {
            rafHandles.push(requestAnimationFrame(() => {
                if (cancelled) return;
                compute();
                startObserve();
            }));
        }));

        return () => {
            cancelled = true;
            for (const h of rafHandles) cancelAnimationFrame(h);
            if (resizeObserver) resizeObserver.disconnect();
        };
    }, [zoomMode, pdfDoc, scrollContainerRef]);

    return scale;
}