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
        let rafHandle = null;

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

        // Defer initial compute one frame so the layout has actually settled
        // before we measure the scroll container. Without this, pdfDoc.getPage()
        // can resolve against a clientWidth that's still pre-layout (the column
        // is rendering at a fraction of its eventual width).
        rafHandle = requestAnimationFrame(() => {
            if (cancelled) return;
            compute();
            if (zoomMode === "fit-width" && scrollContainerRef.current) {
                resizeObserver = new ResizeObserver(() => {
                    if (!cancelled) compute();
                });
                resizeObserver.observe(scrollContainerRef.current);
            }
        });

        return () => {
            cancelled = true;
            if (rafHandle) cancelAnimationFrame(rafHandle);
            if (resizeObserver) resizeObserver.disconnect();
        };
    }, [zoomMode, pdfDoc, scrollContainerRef]);

    return scale;
}