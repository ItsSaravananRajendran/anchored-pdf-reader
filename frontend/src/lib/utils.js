/**
 * Tiny utilities. Pure functions only — no React, no DOM, no globals.
 */

/** Stable, sortable-ish unique id. Crypto if available; falls back to time+rand. */
export function uuid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return "u-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

/** Escape a string for safe HTML interpolation. */
export function escapeHtml(value) {
    if (value == null) return "";
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/** Debounce: defer fn until `wait` ms have passed since last call. */
export function debounce(fn, wait = 200) {
    let timer = null;
    const wrapped = (...args) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            fn(...args);
        }, wait);
    };
    wrapped.cancel = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };
    return wrapped;
}

/** Throttle: invoke at most once per `wait` ms. */
export function throttle(fn, wait = 100) {
    let last = 0;
    let scheduled = null;
    return (...args) => {
        const now = Date.now();
        if (now - last >= wait) {
            last = now;
            fn(...args);
        } else if (!scheduled) {
            scheduled = setTimeout(() => {
                last = Date.now();
                scheduled = null;
                fn(...args);
            }, wait - (now - last));
        }
    };
}

/** Read a CSS custom property from :root. */
export function getCssVar(name) {
    if (typeof document === "undefined") return "";
    const value = getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim();
    return value;
}

/** Clamp a number into [min, max]. */
export function clamp(value, min, max) {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

/** Sort an array of objects by a numeric key. */
export function sortBy(items, key, direction = "desc") {
    const sorted = [...items];
    sorted.sort((a, b) => {
        const av = a[key];
        const bv = b[key];
        if (av === bv) return 0;
        return direction === "asc" ? av - bv : bv - av;
    });
    return sorted;
}

/** Truncate a string with ellipsis. */
export function truncate(text, max = 80) {
    if (!text) return "";
    if (text.length <= max) return text;
    return text.slice(0, max - 1) + "…";
}