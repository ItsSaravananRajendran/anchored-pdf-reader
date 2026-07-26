/**
 * ErrorState — a recoverable error with a retry button.
 */

export default function ErrorState({ message, onRetry }) {
    return (
        <div className="error-state">
            <div className="error-icon" aria-hidden="true">!</div>
            <p className="error-message">{message}</p>
            {onRetry && (
                <button className="btn" onClick={onRetry}>Retry</button>
            )}
        </div>
    );
}