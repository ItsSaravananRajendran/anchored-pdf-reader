/**
 * useAnchorActions — handlers for drag-commit, anchor-click, anchor-delete,
 * and new-session. All depend on AppContext state + local setters that the
 * caller (App.jsx) owns.
 */

import { useCallback } from "react";
import * as api from "../api/client";
import { useApp } from "../state/AppContext";

export function useAnchorActions({
    pdfInfo,
    state,
    dispatch,
    setMessages,
    setSessionLabel,
    pageJump,
    loader,
    session,
}) {
    const commitRect = useCallback(async (rect, pageNum) => {
        const pdfHash = state.pdfInfo?.pdf_hash;
        if (!pdfHash) return;
        try {
            const { anchors } = await api.getPdfAnchors(pdfHash);
            dispatch({ type: "BOOK_ANCHORS_SET", payload: { bookAnchors: anchors } });
        } catch { /* ignore */ }
        try {
            const res = await fetch(`/api/pdf/${pdfHash}/rect.png`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ page: pageNum, rect, scale: 2.0 }),
            });
            const blob = await res.blob();
            const dataUrl = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            });
            dispatch({
                type: "PENDING_ANCHOR_SET",
                payload: { anchor: { page: pageNum, rect, rotation: 0, thumbDataUrl: dataUrl } },
            });
        } catch (e) { console.error("[useAnchorActions] commitRect failed:", e); }
    }, [state.pdfInfo, dispatch]);

    const loadSessionForAnchor = useCallback(async (anchor) => {
        if (!anchor?.session_id) return;
        try {
            const { messages: loaded } = await api.getSessionMessages(anchor.session_id);
            setMessages(loaded);
            dispatch({
                type: "SESSION_LOADED",
                payload: { sessionId: anchor.session_id, anchors: [] },
            });
            setSessionLabel("viewing old session");
            if (anchor.anchor_page) pageJump.scrollToPage(anchor.anchor_page);
        } catch (e) { console.error("[useAnchorActions] loadSessionForAnchor failed:", e); }
    }, [dispatch, setMessages, setSessionLabel, pageJump]);

    const deleteAnchor = useCallback(async (anchor) => {
        const pdfHash = state.pdfInfo?.pdf_hash;
        try {
            await api.deleteAnchor(anchor.message_id);
            setMessages((m) => m.filter((msg) => !(
                msg.anchor_page === anchor.anchor_page
                && JSON.stringify(msg.anchor_rect) === JSON.stringify(anchor.anchor_rect)
            )));
            if (pdfHash) await loader.refreshBookAnchors(pdfHash);
        } catch (e) { console.error("[useAnchorActions] deleteAnchor failed:", e); }
    }, [state.pdfInfo, setMessages, loader]);

    const newSession = useCallback(async () => {
        if (!pdfInfo) return;
        const sid = await session.createSession(pdfInfo.pdf_hash);
        setMessages([]);
        setSessionLabel("new session");
        return sid;
    }, [pdfInfo, session, setMessages, setSessionLabel]);

    return { commitRect, loadSessionForAnchor, deleteAnchor, newSession };
}