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
        async function compute() {
            if (zoomMode === "fit-width") {
                if (!pdfDoc || !scrollContainerRef.current) return;
                const page = await pdfDoc.getPage(1);
                const v = page.getViewport({ scale: 1.0 });
                const cw = (scrollContainerRef.current.clientWidth || 800) - 32;
                if (!cancelled) setScale(Math.max(0.25, cw / v.width));
            } else if (!cancelled) {
                setScale(parseFloat(zoomMode) || 1.0);
            }
        }
        compute();
        return () => { cancelled = true; };
    }, [zoomMode, pdfDoc, scrollContainerRef]);

    return scale;
}