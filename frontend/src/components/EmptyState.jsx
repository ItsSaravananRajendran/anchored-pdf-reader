/**
 * EmptyState — shown when no PDF is loaded.
 */

export default function EmptyState({ onLoadClick }) {
    return (
        <div className="empty-state">
            <svg className="empty-illustration" width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
                <rect x="20" y="15" width="80" height="90" rx="4" fill="var(--bg-elev-2)" stroke="var(--border-default)" strokeWidth="2" />
                <line x1="32" y1="35" x2="80" y2="35" stroke="var(--border-default)" strokeWidth="2" />
                <line x1="32" y1="50" x2="80" y2="50" stroke="var(--border-default)" strokeWidth="2" />
                <line x1="32" y1="65" x2="60" y2="65" stroke="var(--border-default)" strokeWidth="2" />
            </svg>
            <h2 className="empty-title">No PDF loaded</h2>
            <p className="empty-subtitle">Drop a URL above to get started.</p>
            <button className="btn primary" onClick={onLoadClick}>Load a PDF</button>
        </div>
    );
}