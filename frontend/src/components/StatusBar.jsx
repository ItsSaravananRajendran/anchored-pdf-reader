/**
 * StatusBar — bottom strip showing render budget + connection state.
 */

export default function StatusBar({ pdfInfo, renderedPages, pageCount, scale }) {
    if (!pdfInfo) return null;
    return (
        <footer className="status-bar" role="status">
            <span className="status-bar-item">
                {pdfInfo.title || "Untitled"}
            </span>
            <span className="status-bar-divider" />
            <span className="status-bar-item">
                {renderedPages} / {pageCount} pages
            </span>
            <span className="status-bar-divider" />
            <span className="status-bar-item">
                Zoom: {Math.round(scale * 100)}%
            </span>
        </footer>
    );
}