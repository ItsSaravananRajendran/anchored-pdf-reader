/**
 * Pointer drag selection on a per-page overlay canvas.
 *
 * Returns handlers (onPointerDown, onPointerMove, onPointerUp) to spread
 * onto the overlay element. Calls `onCommit(rect)` when the user finishes
 * a drag with a rect above the minimum threshold.
 */

import { useRef } from "react";
import { clientToNormalized } from "../lib/coords";
import { normalizeRect, pointInRect, rectsEqual } from "../lib/rect";

const MIN_AREA = 0.0005; // normalized area; ignore tiny drags

export function useDragSelection({
    onCommit,
    onClick, // (rect) => void — click on a historical rect (not a drag)
    historicalAnchors = [],
    threshold = 0.02, // px-normalized; above this, it's a drag
}) {
    const stateRef = useRef({
        dragging: false,
        start: null,
        cur: null,
        clickedAnchor: null,
    });

    function onPointerDown(e) {
        if (e.button !== 0) return; // left-click only
        const overlay = e.currentTarget;
        const rect = overlay.getBoundingClientRect();
        const p = clientToNormalized(e.clientX, e.clientY, rect);
        // Hit-test historical anchors first
        const hit = historicalAnchors.find(
            (a) => a.anchor_page === parseInt(overlay.dataset.page, 10)
                && pointInRect(p.x, p.y, normalizeRect(a.anchor_rect, {
                    x: a.anchor_rect.x + a.anchor_rect.w,
                    y: a.anchor_rect.y + a.anchor_rect.h,
                })),
        );
        if (hit) {
            stateRef.current = {
                dragging: false,
                start: null,
                cur: null,
                clickedAnchor: hit,
            };
            overlay.setPointerCapture?.(e.pointerId);
            return;
        }
        // Begin a new draw
        stateRef.current = { dragging: true, start: p, cur: p, clickedAnchor: null };
        overlay.setPointerCapture?.(e.pointerId);
    }

    function onPointerMove(e) {
        const s = stateRef.current;
        const overlay = e.currentTarget;
        const rect = overlay.getBoundingClientRect();
        const p = clientToNormalized(e.clientX, e.clientY, rect);
        if (s.clickedAnchor) return; // wait for pointerup
        if (s.dragging && s.start) {
            // Transition from click→drag: only start drawing once we've moved past threshold
            if (!s.cur || Math.abs(p.x - s.start.x) > threshold || Math.abs(p.y - s.start.y) > threshold) {
                s.cur = p;
            }
        }
    }

    function onPointerUp(e) {
        const s = stateRef.current;
        const overlay = e.currentTarget;
        overlay.releasePointerCapture?.(e.pointerId);
        if (s.clickedAnchor) {
            // Was a click on a historical anchor — fire callback
            if (onClick) onClick(s.clickedAnchor);
            stateRef.current = { dragging: false, start: null, cur: null, clickedAnchor: null };
            return;
        }
        if (!s.start || !s.cur) return;
        const r = normalizeRect(s.start, s.cur);
        const area = r.w * r.h;
        stateRef.current = { dragging: false, start: null, cur: null, clickedAnchor: null };
        if (area < MIN_AREA) return;
        if (onCommit) onCommit(r);
    }

    function currentDragRect() {
        const s = stateRef.current;
        if (!s.dragging || !s.start || !s.cur) return null;
        return normalizeRect(s.start, s.cur);
    }

    return { onPointerDown, onPointerMove, onPointerUp, currentDragRect };
}