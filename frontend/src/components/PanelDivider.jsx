/**
 * PanelDivider — drag handle between reader and chat. Updates CSS
 * grid-template-columns on the parent.
 */

import { useRef, useCallback, useEffect } from "react";

const MIN = 240;
const MAX_RATIO = 0.85; // chat can be at most 85% of viewport

export default function PanelDivider({ getChatWidth, setChatWidth, persistPrefs }) {
    const draggingRef = useRef(false);
    const startRef = useRef({ x: 0, w: 0 });

    const onPointerDown = useCallback((e) => {
        draggingRef.current = true;
        startRef.current = { x: e.clientX, w: getChatWidth() };
        document.body.classList.add("is-resizing");
        e.currentTarget.setPointerCapture?.(e.pointerId);
    }, [getChatWidth]);

    const onPointerMove = useCallback((e) => {
        if (!draggingRef.current) return;
        const dx = startRef.current.x - e.clientX; // drag left = chat grows
        const maxW = Math.floor(window.innerWidth * MAX_RATIO);
        const newW = Math.max(MIN, Math.min(maxW, startRef.current.w + dx));
        setChatWidth(newW);
        persistPrefs();
    }, [setChatWidth, persistPrefs]);

    const onPointerUp = useCallback((e) => {
        draggingRef.current = false;
        document.body.classList.remove("is-resizing");
        try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch {}
    }, []);

    useEffect(() => {
        return () => {
            document.body.classList.remove("is-resizing");
        };
    }, []);

    return (
        <div
            id="panelDivider"
            className="panel-divider"
            role="separator"
            aria-orientation="vertical"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            title="Drag to resize chat panel"
        />
    );
}