/**
 * Persistent UI preferences (zoom mode + chat width).
 *
 * Stored in localStorage under a single key. Survives refresh.
 * On load, reads from storage and calls the parent's setter functions.
 */

import { useEffect } from "react";

const KEY = "pdfreader.prefs.v1";
const SCHEMA_VERSION = 2;

// v2: default zoom is now fit-width. Wipe any v1 prefs so legacy
// sessions don't reapply the old numeric zoom (which left white
// space around the page on wider columns). New prefs get repopulated
// from the current state on the next render.
(function migrateLegacyPrefs() {
    try {
        if (typeof localStorage === "undefined") return;
        const raw = localStorage.getItem(KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && parsed.__v === SCHEMA_VERSION) return;
        localStorage.removeItem(KEY);
    } catch { /* ignore */ }
})();

export function loadPrefs() {
    if (typeof localStorage === "undefined") return {};
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return {};
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

export function savePrefs(prefs) {
    if (typeof localStorage === "undefined") return;
    try {
        localStorage.setItem(KEY, JSON.stringify({ ...prefs, __v: SCHEMA_VERSION }));
    } catch {
        // Quota exceeded or private mode — ignore
    }
}

/**
 * React hook: apply persisted prefs on mount, save on change.
 *
 * @param {Object} args
 * @param {string} zoomMode            - current zoom mode (e.g. "1.0", "fit-width")
 * @param {() => string} setZoomMode   - setter from React state
 * @param {number} chatWidth           - current chat panel width in px
 * @param {(n: number) => void} setChatWidth
 */
export function usePersistence({ zoomMode, setZoomMode, chatWidth, setChatWidth }) {
    // On mount: apply persisted prefs.
    // "fit-width" is now the canonical default — older sessions may have
    // persisted a numeric zoom (e.g. "1.0") that leaves whitespace around
    // the page on wider columns. Treat any legacy value as fit-width.
    useEffect(() => {
        const prefs = loadPrefs();
        const persistedZoom = prefs.zoomMode;
        if (persistedZoom === "fit-width") {
            setZoomMode("fit-width");
        } else if (persistedZoom) {
            // Migrate legacy numeric zoom to fit-width so the page fills
            // the column. User can still pick a numeric zoom from the
            // toolbar and that choice will be persisted going forward.
            setZoomMode("fit-width");
        }
        if (Number.isFinite(prefs.chatWidth)) setChatWidth(prefs.chatWidth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // On change: persist
    useEffect(() => {
        savePrefs({ zoomMode, chatWidth });
    }, [zoomMode, chatWidth]);
}