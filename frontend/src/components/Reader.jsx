/**
 * Reader — single-page view driven by currentPage state.
 *
 * Renders ONE PageCanvas, wrapped in `.pdf-canvas-wrap` so the layout grid
 * matches the multi-page version. No internal scrolling.
 */

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
}) {
    const pageCount = pdfInfo?.page_count || 0;

    if (!pdfInfo || pageNum < 1 || pageNum > pageCount) {
        return (
            <main className="reader">
                <div className="reader-scroll" id="pdfScroll">
                    <div className="pdf-canvas-wrap">
                        <div className="reader-empty">No page selected</div>
                    </div>
                </div>
            </main>
        );
    }

    const width = Math.round(612 * (96 / 72) * scale);

    return (
        <main className="reader">
            <div className="reader-scroll reader-single-page" id="pdfScroll">
                <div className="pdf-canvas-wrap">
                    <PageCanvas
                        key={pageNum}
                        pageNum={pageNum}
                        width={width}
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
