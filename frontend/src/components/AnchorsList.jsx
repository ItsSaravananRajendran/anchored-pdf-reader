/**
 * AnchorsList — sidebar list grouped by conversation thread (session).
 *
 * Each session is one conversation anchored to a specific page region.
 * We display ONE row per session showing the first user question, with
 * a small badge showing how many follow-ups (Q + A) live in that thread.
 * Clicking the row loads the session into the chat and scrolls to the
 * anchor's exact location on the page.
 */

import { useMemo } from "react";
import AnchorChip from "./AnchorChip";

export default function AnchorsList({ anchors, onClick, onDelete }) {
    // Group by session_id, pick the first user message of each thread.
    const sessions = useMemo(() => {
        const bySession = new Map();
        for (const a of anchors) {
            if (!a.session_id) continue;
            const existing = bySession.get(a.session_id);
            // First user message wins as the row title.
            if (!existing) {
                bySession.set(a.session_id, { session: a, messages: [a] });
            } else {
                existing.messages.push(a);
                // If this message is user and earlier, promote it as the title.
                if (a.role === "user" && a.created_at < existing.session.created_at) {
                    existing.session = a;
                }
            }
        }
        // Stable order: earliest first message wins.
        return Array.from(bySession.values()).sort(
            (a, b) => a.session.created_at - b.session.created_at,
        );
    }, [anchors]);

    return (
        <div className="anchors-list" role="list">
            {sessions.length === 0 ? (
                <div className="anchors-empty">No anchors yet. Drag on a page to create one.</div>
            ) : (
                sessions.map(({ session, messages }) => (
                    <AnchorChip
                        key={session.session_id}
                        anchor={session}
                        followUpCount={messages.length - 1}
                        onClick={onClick}
                        onDelete={onDelete}
                    />
                ))
            )}
        </div>
    );
}
