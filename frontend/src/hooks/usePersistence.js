/**
 * Persistent UI preferences (zoom mode + chat width).
 *
 * Stored in localStorage under a single key. Survives refresh.
 * On load, reads from storage and calls the parent's setter functions.
 */

import { useEffect } from "react";

const KEY = "pdfreader.prefs.v1";

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
        localStorage.setItem(KEY, JSON.stringify(prefs));
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
    // On mount: apply persisted prefs
    useEffect(() => {
        const prefs = loadPrefs();
        if (prefs.zoomMode) setZoomMode(prefs.zoomMode);
        if (Number.isFinite(prefs.chatWidth)) setChatWidth(prefs.chatWidth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // On change: persist
    useEffect(() => {
        savePrefs({ zoomMode, chatWidth });
    }, [zoomMode, chatWidth]);
}