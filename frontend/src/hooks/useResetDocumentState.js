/**
 * useResetDocumentState — resets every per-document piece of local state.
 *
 * Called when the user opens a new PDF (either from URL or from library)
 * so we don't leak messages, page-index, scroll position, etc. from the
 * previous document.
 */

import { useCallback } from "react";

export function useResetDocumentState({
    setCurrentPage,
    setMessages,
    setSessionLabel,
    setRenderedPages,
    scrollContainerRef,
}) {
    return useCallback(() => {
        setCurrentPage(1);
        setMessages([]);
        setSessionLabel("");
        setRenderedPages(0);
        if (scrollContainerRef?.current) {
            scrollContainerRef.current.scrollTop = 0;
        }
    }, [setCurrentPage, setMessages, setSessionLabel, setRenderedPages, scrollContainerRef]);
}