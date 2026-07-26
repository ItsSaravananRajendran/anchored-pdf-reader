/**
 * Session management. Create a new session, load an existing one (for
 * the time-machine flow), and switch the current session.
 */

import { useCallback } from "react";
import * as api from "../api/client";
import { events } from "../events";

export function useSession({ dispatch, setPendingAnchor }) {
    const createSession = useCallback(async (pdfHash) => {
        const { session_id } = await api.newSession(pdfHash);
        dispatch({ type: "SESSION_CREATED", payload: { sessionId: session_id } });
        events.emit("session:created", { sessionId: session_id });
        return session_id;
    }, [dispatch]);

    const loadSession = useCallback(async (sessionId, anchor) => {
        const { messages, pdf_hash } = await api.getSessionMessages(sessionId);
        // Convert anchor_rect JSON string to object
        const anchors = messages
            .filter((m) => m.anchor_page != null && m.anchor_rect)
            .map((m) => ({
                message_id: m.id,
                session_id: sessionId,
                role: m.role,
                anchor_page: m.anchor_page,
                anchor_rect: m.anchor_rect,
                text: m.text,
                created_at: m.created_at,
            }));
        dispatch({
            type: "SESSION_LOADED",
            payload: { sessionId, anchors },
        });
        events.emit("session:loaded", { sessionId, messages, anchor, anchors });
        return { sessionId, pdfHash: pdf_hash };
    }, [dispatch]);

    const deleteSession = useCallback(async (sessionId) => {
        await api.deleteSession(sessionId);
    }, []);

    return { createSession, loadSession, deleteSession };
}