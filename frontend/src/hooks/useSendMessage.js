/**
 * useSendMessage — handle sending a chat message end-to-end.
 *
 * On submit: append user message, append streaming assistant placeholder,
 * call the SSE chat endpoint, update the assistant message as tokens arrive.
 */

import { useCallback } from "react";
import { streamChat } from "../api/sse";
import { uuid } from "../lib/utils";
import { useApp } from "../state/AppContext";

export function useSendMessage({ pendingAnchor, sessionId, setMessages, onAfterSend }) {
    const { dispatch } = useApp();

    const send = useCallback(async (text) => {
        // First message in a new session requires an anchor (we always
        // anchor a chat to a specific PDF region). Follow-up messages
        // in an active session don't need a fresh anchor — the user is
        // continuing the same conversation.
        const isFirstMessage = !!pendingAnchor;
        if (!sessionId) return;
        if (isFirstMessage && !pendingAnchor) return;
        const userMsgId = uuid();
        const assistantMsgId = uuid();

        // For the first message, anchor metadata travels with it. For
        // follow-ups, anchor stays null on the message and we let the
        // backend inherit the session's anchor context.
        const userMsg = isFirstMessage
            ? {
                id: userMsgId,
                role: "user",
                text,
                anchor_page: pendingAnchor.page,
                anchor_rect: pendingAnchor.rect,
                thumbDataUrl: pendingAnchor.thumbDataUrl,
                status: "complete",
                created_at: Date.now(),
            }
            : {
                id: userMsgId,
                role: "user",
                text,
                status: "complete",
                created_at: Date.now(),
            };
        const assistantMsg = {
            id: assistantMsgId,
            role: "assistant",
            text: "",
            status: "streaming",
            created_at: Date.now(),
        };
        setMessages((m) => [...m, userMsg, assistantMsg]);
        if (isFirstMessage) dispatch({ type: "PENDING_ANCHOR_CLEAR" });

        const controller = new AbortController();
        try {
            await streamChat({
                sessionId,
                messageId: userMsgId,
                text,
                anchor: isFirstMessage
                    ? {
                        page: pendingAnchor.page,
                        rect: pendingAnchor.rect,
                        rotation: pendingAnchor.rotation || 0,
                    }
                    : null,
                signal: controller.signal,
                onToken: (chunk) => {
                    // streamChat sends one token at a time. Accumulate
                    // locally so the bubble shows the running reply.
                    setMessages((m) => m.map((msg) => (
                        msg.id === assistantMsgId
                            ? { ...msg, text: (msg.text || "") + chunk }
                            : msg
                    )));
                },
                onDone: () => {
                    setMessages((m) => m.map((msg) => (
                        msg.id === assistantMsgId ? { ...msg, status: "complete" } : msg
                    )));
                    if (onAfterSend) onAfterSend();
                },
                onError: (message) => {
                    setMessages((m) => m.map((msg) => (
                        msg.id === assistantMsgId
                            ? { ...msg, status: "failed", text: msg.text + `\n\n(error: ${message})` }
                            : msg
                    )));
                },
            });
        } catch (err) {
            if (err.name !== "AbortError") {
                setMessages((m) => m.map((msg) => (
                    msg.id === assistantMsgId
                        ? { ...msg, status: "failed", text: msg.text + `\n\n(error: ${err.message})` }
                        : msg
                )));
            }
        }
    }, [pendingAnchor, sessionId, setMessages, dispatch, onAfterSend]);

    return send;
}