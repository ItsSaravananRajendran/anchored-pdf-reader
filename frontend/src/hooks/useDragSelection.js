/**
 * Pointer drag selection on a per-page overlay canvas.
 *
 * Returns:
 *  - onPointerDown / onPointerMove / onPointerUp: spread onto the overlay element
 *  - subscribe(cb): callback fired whenever the drag rect changes; pass `null`
 *    to unsubscribe. Used by PageCanvas to redraw the live-drag overlay
 *    without polling via rAF.
 *
 * Calls `onCommit(rect)` when the user finishes a drag with a rect above the
 * minimum threshold. Calls `onClick(anchor)` for clicks that hit a historical
 * anchor rect.
 */

import { useEffect, useRef } from "react";
import { clientToNormalized } from "../lib/coords";
import { normalizeRect, pointInRect } from "../lib/rect";

const MIN_AREA = 0.0005; // normalized area; ignore tiny drags

export function useDragSelection({
    onCommit,
    onClick, // (anchor) => void — click on a historical rect
    historicalAnchors = [],
    threshold = 0.02,
}) {
    const stateRef = useRef({
        dragging: false,
        start: null,
        cur: null,
        clickedAnchor: null,
    });
    const subRef = useRef(null);

    function _notify(rect) {
        if (subRef.current) subRef.current(rect);
    }

    function onPointerDown(e) {
        if (e.button !== 0) return;
        const overlay = e.currentTarget;
        const rect = overlay.getBoundingClientRect();
        const p = clientToNormalized(e.clientX, e.clientY, rect);
        const hit = historicalAnchors.find(
            (a) => a.anchor_page === parseInt(overlay.dataset.page, 10)
                && pointInRect(p.x, p.y, normalizeRect(a.anchor_rect, {
                    x: a.anchor_rect.x + a.anchor_rect.w,
                    y: a.anchor_rect.y + a.anchor_rect.h,
                })),
        );
        if (hit) {
            stateRef.current = {
                dragging: false, start: null, cur: null, clickedAnchor: hit,
            };
            overlay.setPointerCapture?.(e.pointerId);
            return;
        }
        stateRef.current = { dragging: true, start: p, cur: p, clickedAnchor: null };
        overlay.setPointerCapture?.(e.pointerId);
        _notify(null);
    }

    function onPointerMove(e) {
        const s = stateRef.current;
        const overlay = e.currentTarget;
        const rect = overlay.getBoundingClientRect();
        const p = clientToNormalized(e.clientX, e.clientY, rect);
        if (s.clickedAnchor) return;
        if (s.dragging && s.start) {
            if (!s.cur || Math.abs(p.x - s.start.x) > threshold || Math.abs(p.y - s.start.y) > threshold) {
                s.cur = p;
                const r = normalizeRect(s.start, s.cur);
                _notify(r);
            }
        }
    }

    function onPointerUp(e) {
        const s = stateRef.current;
        const overlay = e.currentTarget;
        overlay.releasePointerCapture?.(e.pointerId);
        if (s.clickedAnchor) {
            if (onClick) onClick(s.clickedAnchor);
            stateRef.current = { dragging: false, start: null, cur: null, clickedAnchor: null };
            return;
        }
        if (!s.start || !s.cur) return;
        const r = normalizeRect(s.start, s.cur);
        const area = r.w * r.h;
        stateRef.current = { dragging: false, start: null, cur: null, clickedAnchor: null };
        _notify(null);
        if (area < MIN_AREA) return;
        if (onCommit) onCommit(r);
    }

    function subscribe(cb) {
        subRef.current = cb;
        return () => { subRef.current = null; };
    }

    // When historicalAnchors changes, our hit-test might be different. No
    // explicit invalidate needed here — the next pointerdown will use the
    // latest array via closure.

    return {
        onPointerDown,
        onPointerMove,
        onPointerUp,
        subscribe,
    };
}
