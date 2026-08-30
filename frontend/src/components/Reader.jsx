/**
 * Reader — the PDF scroll container with one PageCanvas per page.
 * Uses useVirtualPages to keep memory bounded.
 */

import { useRef } from "react";
import PageCanvas from "./PageCanvas";

export default function Reader({
    pdfInfo,
    pdfDoc,
    displayScale,
    sourceScale,
    scrollContainerRef,
    pages,
    setPageEntry,
    scheduleRender,
    onCommitRect,
    onClickAnchor,
    historicalAnchors,
}) {
    const pageCount = pdfInfo?.page_count || 0;
    // Estimate page width for layout before any page renders. NATURAL_WIDTH_CSS
    // is the natural page width at scale=1.0 (612pt * 96/72 = 816 for Letter).
    // The wrap's actual width = NATURAL_WIDTH_CSS * displayScale (computed
    // inside PageCanvas), so the scrollbar positions correctly.
    const NATURAL_WIDTH_PT = 612; // letter-size; A4 is 595
    const NATURAL_WIDTH_CSS = NATURAL_WIDTH_PT * (96 / 72);

    const innerRef = useRef(null);

    return (
        <main className="reader" ref={innerRef}>
            <div className="reader-scroll" id="pdfScroll" ref={scrollContainerRef}>
                <div className="pdf-canvas-wrap">
                    {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
                        <PageCanvas
                            key={p}
                            pageNum={p}
                            width={NATURAL_WIDTH_CSS}
                            displayScale={displayScale}
                            sourceScale={sourceScale}
                            pageEntry={pages[p]}
                            setPageEntry={setPageEntry}
                            scheduleRender={scheduleRender}
                            onCommitRect={onCommitRect}
                            onClickAnchor={onClickAnchor}
                            historicalAnchors={historicalAnchors}
                        />
                    ))}
                </div>
            </div>
        </main>
    );
}