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
        if (!pendingAnchor || !sessionId) return;
        const userMsgId = uuid();
        const assistantMsgId = uuid();

        // Optimistically append
        const userMsg = {
            id: userMsgId,
            role: "user",
            text,
            anchor_page: pendingAnchor.page,
            anchor_rect: pendingAnchor.rect,
            thumbDataUrl: pendingAnchor.thumbDataUrl,
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
        dispatch({ type: "PENDING_ANCHOR_CLEAR" });

        const controller = new AbortController();
        try {
            await streamChat({
                sessionId,
                messageId: userMsgId,
                text,
                anchor: {
                    page: pendingAnchor.page,
                    rect: pendingAnchor.rect,
                    rotation: pendingAnchor.rotation || 0,
                },
                signal: controller.signal,
                onToken: (chunk, accumulated) => {
                    setMessages((m) => m.map((msg) => (
                        msg.id === assistantMsgId ? { ...msg, text: accumulated } : msg
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