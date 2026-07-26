/**
 * Action creators — small helpers that return action objects.
 * Keep them in one place so consumers don't need to know action shapes.
 */

export const setStatus = (status, errorMessage = null) => ({
    type: "STATUS",
    payload: { status, errorMessage },
});

export const setPdfLoaded = (pdfInfo) => ({
    type: "PDF_LOADED",
    payload: { pdfInfo },
});

export const setPdfDoc = (pdfDoc) => ({
    type: "PDF_DOC_READY",
    payload: { pdfDoc },
});

export const clearPdf = () => ({ type: "PDF_CLEAR" });

export const setLibrary = (library) => ({
    type: "LIBRARY_SET",
    payload: { library },
});

export const setBookAnchors = (bookAnchors) => ({
    type: "BOOK_ANCHORS_SET",
    payload: { bookAnchors },
});

export const setSessionCreated = (sessionId) => ({
    type: "SESSION_CREATED",
    payload: { sessionId },
});

export const setSessionLoaded = (sessionId, anchors) => ({
    type: "SESSION_LOADED",
    payload: { sessionId, anchors },
});

export const resetViewingOldSession = () => ({ type: "SESSION_VIEWING_RESET" });

export const setPendingAnchor = (anchor) => ({
    type: "PENDING_ANCHOR_SET",
    payload: { anchor },
});

export const clearPendingAnchor = () => ({ type: "PENDING_ANCHOR_CLEAR" });

export const setVisibleAnchors = (anchors) => ({
    type: "VISIBLE_ANCHORS_SET",
    payload: { anchors },
});