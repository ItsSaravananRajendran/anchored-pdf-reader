/**
 * ReaderToolbar — URL bar, Load button, library, zoom, page navigation.
 *
 * Paging mode: ← / → buttons + N / total indicator + jump input.
 * Keyboard ← / → handled in App.jsx via usePageNavigation.
 */

import LibraryDropdown from "./LibraryDropdown";

const ZOOM_OPTIONS = ["0.5", "0.75", "1.0", "1.25", "1.5", "2.0", "fit-width"];

export default function ReaderToolbar({
    pdfInfo,
    library,
    urlInput,
    setUrlInput,
    onLoad,
    onPickFromLibrary,
    zoomMode,
    setZoomMode,
    currentPage,
    pageCount,
    onPrev,
    onNext,
    onGoToPage,
    onClearPending,
    pendingAnchor,
}) {
    return (
        <header className="reader-bar">
            <div className="reader-bar-left">
                <input
                    id="urlInput"
                    type="url"
                    className="url-input"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") onLoad(); }}
                    placeholder="https://…/paper.pdf"
                    spellCheck={false}
                />
                <button id="loadBtn" className="btn primary" onClick={onLoad} disabled={!urlInput.trim()}>
                    Load
                </button>
                <LibraryDropdown library={library} onPick={onPickFromLibrary} />
            </div>
            <div className="reader-bar-right">
                {pdfInfo && (
                    <div className="page-nav">
                        <button
                            id="prevPageBtn"
                            className="btn ghost"
                            onClick={onPrev}
                            disabled={currentPage <= 1}
                            title="Previous page (←)"
                            aria-label="Previous page"
                        >
                            ←
                        </button>
                        <span className="page-indicator" id="pageIndicator">
                            <span className="current">{currentPage}</span>
                            <span className="sep"> / </span>
                            <span className="total">{pageCount}</span>
                        </span>
                        <button
                            id="nextPageBtn"
                            className="btn ghost"
                            onClick={onNext}
                            disabled={currentPage >= pageCount}
                            title="Next page (→)"
                            aria-label="Next page"
                        >
                            →
                        </button>
                        <input
                            id="pageJump"
                            type="number"
                            min="1"
                            max={pageCount || undefined}
                            className="page-jump"
                            placeholder="#"
                            onChange={(e) => {
                                const n = parseInt(e.target.value, 10);
                                if (Number.isFinite(n) && n >= 1 && n <= pageCount) onGoToPage(n);
                                e.target.value = "";
                            }}
                            disabled={!pdfInfo}
                            title="Jump to page"
                            aria-label="Jump to page"
                        />
                    </div>
                )}
                {pendingAnchor && (
                    <button className="btn ghost" onClick={onClearPending} title="Clear pending anchor">
                        Clear anchor
                    </button>
                )}
                <select
                    id="zoomSelect"
                    className="zoom-select"
                    value={zoomMode}
                    onChange={(e) => setZoomMode(e.target.value)}
                    disabled={!pdfInfo}
                >
                    {ZOOM_OPTIONS.map((z) => (
                        <option key={z} value={z}>
                            {z === "fit-width" ? "Fit width" : `${Math.round(parseFloat(z) * 100)}%`}
                        </option>
                    ))}
                </select>
            </div>
        </header>
    );
}
