/**
 * ReaderToolbar — URL bar, Load button, Library dropdown, zoom select, page-jump input.
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
    onPageJump,
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
                <input
                    id="pageJump"
                    type="number"
                    min="1"
                    className="page-jump"
                    value=""
                    placeholder="#"
                    onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        if (Number.isFinite(n) && n >= 1) onPageJump(n);
                    }}
                    disabled={!pdfInfo}
                    title="Type a page number"
                />
            </div>
        </header>
    );
}