/**
 * Pure rectangle math. No DOM access, no React.
 * All functions take and return plain objects.
 */

/** Normalize a drag selection to { x, y, w, h } in [0..1] page coords. */
export function normalizeRect(a, b) {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(a.x - b.x);
    const h = Math.abs(a.y - b.y);
    return { x, y, w, h };
}

/** True if rects overlap (used for hit-testing historical anchors). */
export function rectsOverlap(a, b, tolerance = 0) {
    return !(
        a.x + a.w < b.x - tolerance ||
        b.x + b.w < a.x - tolerance ||
        a.y + a.h < b.y - tolerance ||
        b.y + b.h < a.y - tolerance
    );
}

/** True if (x, y) falls inside rect. Coords are normalized. */
export function pointInRect(x, y, rect) {
    return (
        x >= rect.x &&
        x <= rect.x + rect.w &&
        y >= rect.y &&
        y <= rect.y + rect.h
    );
}

/** Compare two normalized rects with tolerance for floating-point noise. */
export function rectsEqual(a, b, tolerance = 1e-4) {
    return (
        Math.abs(a.x - b.x) < tolerance &&
        Math.abs(a.y - b.y) < tolerance &&
        Math.abs(a.w - b.w) < tolerance &&
        Math.abs(a.h - b.h) < tolerance
    );
}