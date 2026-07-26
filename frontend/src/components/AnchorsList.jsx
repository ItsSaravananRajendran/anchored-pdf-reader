/**
 * AnchorsList — sidebar list of every anchor question in the current book.
 *
 * Groups backend messages by (session_id, anchor_page, anchor_rect) so each
 * Q+A pair becomes a single row showing only the question (no answer preview
 * — per user request "just show the page number and the question").
 *
 * Click handlers receive the *user* message so navigation and delete both
 * behave correctly (delete cascades to the assistant row on the backend).
 */

import { useMemo } from "react";
import AnchorChip from "./AnchorChip";

function groupAnchorsByQuestion(anchors) {
    // Backend returns one row per message (Q and A both stored in the
    // `message` table, distinguished by `role`). Group by (session, page,
    // rect). Within each group the user message is the primary; the
    // assistant message is dropped from the row (still in bookAnchors
    // and still drives delete cascading on the backend).
    const groups = new Map();
    for (const a of anchors) {
        const key = `${a.session_id}|${a.anchor_page}|${JSON.stringify(a.anchor_rect)}`;
        if (!groups.has(key)) {
            groups.set(key, {
                id: key,
                sessionId: a.session_id,
                anchorPage: a.anchor_page,
                anchorRect: a.anchor_rect,
                userMessageId: null,
                question: "",
                createdAt: a.created_at,
            });
        }
        const g = groups.get(key);
        if (a.role === "user") {
            g.userMessageId = a.message_id;
            g.question = a.text || g.question;
            if (a.created_at < g.createdAt) g.createdAt = a.created_at;
        } else if (a.role === "assistant" && !g.question) {
            // Fallback: if a user message is missing for some reason,
            // use the assistant's text as the row's "question" so the
            // row still shows something useful.
            g.question = a.text || g.question;
        }
    }
    return Array.from(groups.values()).sort(
        (a, b) => a.anchorPage - b.anchorPage || a.createdAt - b.createdAt,
    );
}

export default function AnchorsList({ anchors, onClick, onDelete }) {
    const grouped = useMemo(() => groupAnchorsByQuestion(anchors || []), [anchors]);

    if (grouped.length === 0) {
        return <div className="anchors-empty">No anchors yet. Drag on a page to create one.</div>;
    }

    return (
        <ul className="anchors-list" role="list">
            {grouped.map((g) => (
                <AnchorChip
                    key={g.id}
                    anchor={g}
                    onClick={onClick}
                    onDelete={onDelete}
                />
            ))}
        </ul>
    );
}
