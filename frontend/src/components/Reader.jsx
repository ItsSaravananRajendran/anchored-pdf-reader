/**
 * Reader — single-page view driven by currentPage state.
 *
 * Renders ONE PageCanvas, wrapped in `.pdf-canvas-wrap` so the layout grid
 * matches the multi-page version. No internal scrolling.
 *
 * The CSS-pixel width comes from the PDF.js viewport (which already does
 * the 96/72 conversion), not a hand-rolled `pdfWidth * 96/72 * scale` —
 * that double-counted the DPI factor and made the wrap wider than the
 * canvas (204px of dead space at scale 1.0).
 */

import { useEffect, useState } from "react";
import PageCanvas from "./PageCanvas";

export default function Reader({
    pdfInfo,
    pdfDoc,
    scale,
    pageNum,
    pages,
    setPageEntry,
    scheduleRender,
    onCommitRect,
    onClickAnchor,
    historicalAnchors,
    scrollContainerRef,
}) {
    const pageCount = pdfInfo?.page_count || 0;
    const [cssWidth, setCssWidth] = useState(612);

    // Resolve the CSS-pixel width from the live viewport (which already
    // accounts for PDF.js's 96/72 DPI conversion at the given scale).
    useEffect(() => {
        let cancelled = false;
        async function resolve() {
            if (!pdfDoc) return;
            try {
                const page = await pdfDoc.getPage(pageNum);
                const v = page.getViewport({ scale, rotation: 0 });
                if (!cancelled) setCssWidth(Math.round(v.width));
            } catch {
                // Fall back to the previous width on error; the canvas
                // already has a CSS width set by _renderOne.
            }
        }
        resolve();
        return () => { cancelled = true; };
    }, [pdfDoc, pageNum, scale]);

    if (!pdfInfo || pageNum < 1 || pageNum > pageCount) {
        return (
            <main className="reader">
                <div className="reader-scroll" id="pdfScroll" ref={scrollContainerRef}>
                    <div className="pdf-canvas-wrap">
                        <div className="reader-empty">No page selected</div>
                    </div>
                </div>
            </main>
        );
    }

    return (
        <main className="reader">
            <div className="reader-scroll reader-single-page" id="pdfScroll" ref={scrollContainerRef}>
                <div className="pdf-canvas-wrap">
                    <PageCanvas
                        key={pageNum}
                        pageNum={pageNum}
                        width={cssWidth}
                        pageEntry={pages[pageNum]}
                        setPageEntry={setPageEntry}
                        scheduleRender={scheduleRender}
                        onCommitRect={onCommitRect}
                        onClickAnchor={onClickAnchor}
                        historicalAnchors={historicalAnchors}
                    />
                </div>
            </div>
        </main>
    );
}
