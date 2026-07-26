/**
 * useFitWidthScale — recompute the scale for "fit width" mode.
 *
 * Returns the current effective scale given the zoomMode and PDF doc.
 * When zoomMode is "fit-width", picks the scale that fills the container
 * minus 32px of padding. Otherwise returns the numeric value.
 *
 * The fit-width computation is reactive to the container width via a
 * ResizeObserver: when the user drags the chat-panel divider or resizes
 * the window, the reader pane's width changes and the scale must
 * recompute. The previous implementation only ran on [zoomMode, pdfDoc,
 * scrollContainerRef] change, so a chat-panel drag left the page frozen
 * at its old scale (still rendered at 612px even though 974px was
 * available).
 */

import { useEffect, useState } from "react";

export function useFitWidthScale({ zoomMode, pdfDoc, scrollContainerRef }) {
    const [scale, setScale] = useState(1.0);

    useEffect(() => {
        let cancelled = false;

        async function computeForContainer() {
            if (!pdfDoc || !scrollContainerRef?.current) return;
            const container = scrollContainerRef.current;
            const cw = (container.clientWidth || 800) - 32;
            const page = await pdfDoc.getPage(1);
            const v = page.getViewport({ scale: 1.0 });
            if (!cancelled) setScale(Math.max(0.25, cw / v.width));
        }

        function recompute() {
            if (cancelled) return;
            if (zoomMode === "fit-width") {
                computeForContainer().catch(() => { /* ignore */ });
            } else {
                setScale(parseFloat(zoomMode) || 1.0);
            }
        }

        recompute();

        // Observe container size changes so fit-width tracks chat-panel
        // drag and window resize. For non-fit-width modes the observer is
        // cheap (no-op recompute) so we attach it unconditionally.
        let observer = null;
        const container = scrollContainerRef?.current;
        if (container && typeof ResizeObserver !== "undefined") {
            observer = new ResizeObserver(() => recompute());
            observer.observe(container);
        }

        return () => {
            cancelled = true;
            if (observer) observer.disconnect();
        };
    }, [zoomMode, pdfDoc, scrollContainerRef]);

    return scale;
}