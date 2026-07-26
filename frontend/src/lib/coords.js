/**
 * Coordinate transforms between client pixels, normalized page coords,
 * and viewport dimensions. No React; pure functions over plain inputs.
 */

/** Map a client-space (x, y) into normalized 0..1 page coords. */
export function clientToNormalized(clientX, clientY, overlayRect) {
    return {
        x: (clientX - overlayRect.left) / overlayRect.width,
        y: (clientY - overlayRect.top) / overlayRect.height,
    };
}

/** Map a normalized point to canvas pixel coords. */
export function normalizedToCanvas(nx, ny, viewport, dpr = 1) {
    return {
        x: nx * viewport.width * dpr,
        y: ny * viewport.height * dpr,
    };
}

/** Estimate natural page height in CSS pixels at a given scale (PDF points → CSS px). */
export function estimatePageHeightCss(scale, naturalHeightPoints = 792) {
    return naturalHeightPoints * (96 / 72) * scale;
}

/** Estimate natural page width in CSS pixels at a given scale. */
export function estimatePageWidthCss(scale, naturalWidthPoints = 612) {
    return naturalWidthPoints * (96 / 72) * scale;
}