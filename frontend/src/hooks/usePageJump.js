/**
 * Page jump + page indicator. Renders the current page in the scroll
 * container based on which page's top is closest to the viewport center.
 *
 * Two responsibilities:
 *  1. scrollToPage(n): render the target page (so its offsetTop is real),
 *     measure, then smooth-scroll to it.
 *  2. updateCurrentPageFromScroll(): on scroll-settle, find the page
 *     whose center is closest to the viewport center and update the
 *     currentPage state.
 */

import { useEffect, useRef } from "react";

export function usePageJump({ pageCount, scrollContainerRef, currentPage, setCurrentPage, schedulePageRender }) {
    const lastTopRef = useRef(-1);

    // Update indicator on scroll (debounced via the scroll handler itself)
    function updateCurrentPageFromScroll() {
        const scroll = scrollContainerRef?.current;
        if (!scroll) return;
        const scrollTop = scroll.scrollTop;
        const viewportCenter = scrollTop + scroll.clientHeight / 2;
        let bestPage = 1;
        let bestDist = Infinity;
        for (let p = 1; p <= pageCount; p += 1) {
            const wrap = scroll.querySelector(`[data-page="${p}"]`);
            if (!wrap) continue;
            const wrapCenter = wrap.offsetTop + wrap.offsetHeight / 2;
            const dist = Math.abs(wrapCenter - viewportCenter);
            if (dist < bestDist) {
                bestDist = dist;
                bestPage = p;
            }
        }
        if (bestPage !== currentPage) setCurrentPage(bestPage);
    }

    // Smooth-scroll to the given page. Schedules the render first so the
    // page's height is correct when we measure offsetTop.
    function scrollToPage(pageNum) {
        if (pageNum < 1 || pageNum > pageCount) return Promise.resolve();
        const scroll = scrollContainerRef?.current;
        if (!scroll) return Promise.resolve();
        schedulePageRender(pageNum);
        // Wait for next frame so the rendered canvas sizes its container
        return new Promise((resolve) => requestAnimationFrame(() => {
            const wrap = scroll.querySelector(`[data-page="${pageNum}"]`);
            if (!wrap) { resolve(); return; }
            const top = wrap.getBoundingClientRect().top + scroll.scrollTop - 8;
            scroll.scrollTo({ top, behavior: "smooth" });
            setCurrentPage(pageNum);
            lastTopRef.current = top;
            // Resolve after the smooth-scroll settles
            setTimeout(resolve, 600);
        }));
    }

    return { scrollToPage, updateCurrentPageFromScroll };
}