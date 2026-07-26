/**
 * Stream a chat turn via SSE.
 *
 * Aborts in-flight stream when called again (prevents interleaved responses).
 * On completion, calls onDone({ status, text }).
 */

import { useEffect, useRef } from "react";
import { streamChat } from "../api/sse";
import { uuid } from "../lib/utils";

export function useChatStream({ sessionId, anchor, text, onDelta, onDone, onError, enabled }) {
    const abortRef = useRef(null);
    const lastRunRef = useRef("");

    useEffect(() => {
        if (!enabled || !sessionId || !anchor || !text) return undefined;
        const messageId = uuid();
        const controller = new AbortController();
        abortRef.current?.abort();
        abortRef.current = controller;
        lastRunRef.current = messageId;

        (async () => {
            let accumulated = "";
            try {
                await streamChat({
                    sessionId,
                    messageId,
                    text,
                    anchor,
                    signal: controller.signal,
                    onToken: (chunk) => {
                        accumulated += chunk;
                        onDelta?.(chunk, accumulated);
                    },
                    onDone: () => {
                        onDone?.({ messageId, status: "complete", text: accumulated });
                    },
                    onError: (message) => {
                        onError?.({ messageId, status: "failed", message, text: accumulated });
                    },
                });
            } catch (err) {
                if (err.name === "AbortError") return;
                onError?.({ messageId, status: "failed", message: String(err), text: accumulated });
            }
        })();

        return () => {
            controller.abort();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, sessionId, anchor?.page, anchor?.rect?.x, text]);
}