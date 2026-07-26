/**
 * MessageBubble — user or assistant message in the chat panel.
 * Assistant messages render markdown + KaTeX via renderMarkdown().
 */

import { useEffect, useState } from "react";
import { renderMarkdown, ensureMarkdownReady } from "../lib/markdown";
import { escapeHtml } from "../lib/utils";

export default function MessageBubble({ message, onAnchorClick }) {
    const isUser = message.role === "user";
    const [html, setHtml] = useState("");

    useEffect(() => {
        // Lazy-init markdown (marked + katex globals) once
        ensureMarkdownReady();
        if (isUser) {
            setHtml(`<p>${escapeHtml(message.text || "")}</p>`);
        } else {
            setHtml(renderMarkdown(message.text || ""));
        }
    }, [message.text, isUser]);

    return (
        <div className={`message ${isUser ? "user" : "assistant"} ${message.status || ""}`}>
            <div className="message-meta">
                {isUser ? "You" : "Assistant"} · p.{message.anchor_page}
                {message.status && message.status !== "complete" && (
                    <span className={`message-status ${message.status}`}> · {message.status}</span>
                )}
            </div>
            {message.thumbDataUrl && (
                <img
                    className="message-thumb"
                    src={message.thumbDataUrl}
                    alt="Anchor crop"
                    onClick={() => onAnchorClick?.(message)}
                />
            )}
            <div
                className="message-body"
                // markdown render output is trusted (we control the renderer
                // and the only source is the LLM, which we don't sanitize here
                // — same risk profile as v1.5)
                dangerouslySetInnerHTML={{ __html: html }}
            />
        </div>
    );
}