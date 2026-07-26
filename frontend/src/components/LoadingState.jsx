/**
 * LoadingState — shown while a PDF is being downloaded.
 */

export default function LoadingState({ message = "Loading PDF…" }) {
    return (
        <div className="loading-state">
            <div className="spinner" aria-hidden="true" />
            <p className="loading-message">{message}</p>
        </div>
    );
}