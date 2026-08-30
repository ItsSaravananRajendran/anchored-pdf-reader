/**
 * AnchorChip — one row in the sidebar list of conversation threads.
 *
 * One row per session. Shows:
 *   - the page badge (p.N)
 *   - the first user question of the conversation
 *   - a small follow-up count badge (e.g. "+2" for 2 follow-up messages)
 *   - the × delete button on hover
 *
 * Click loads the session into the chat and scrolls to the anchor.
 */

import { useState } from "react";
import { truncate } from "../lib/utils";

export default function AnchorChip({ anchor, followUpCount = 0, onClick, onDelete }) {
    const [hovered, setHovered] = useState(false);

    return (
        <div
            className={`anchor-row ${hovered ? "hovered" : ""}`}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={() => onClick(anchor)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onClick(anchor);
                }
            }}
        >
            <span className="page-badge">p.{anchor.anchor_page}</span>
            <div className="anchor-text">
                {truncate(anchor.text || "(no text)", 60)}
            </div>
            {followUpCount > 0 && (
                <span className="anchor-followups" title={`${followUpCount} follow-up message${followUpCount === 1 ? "" : "s"}`}>
                    +{followUpCount}
                </span>
            )}
            {onDelete && (
                <button
                    className="anchor-delete"
                    onClick={(e) => {
                        e.stopPropagation();
                        if (confirm("Delete this conversation thread and all its messages? This cannot be undone.")) {
                            onDelete(anchor);
                        }
                    }}
                    aria-label="Delete conversation thread"
                    title="Delete conversation thread"
                >
                    ×
                </button>
            )}
        </div>
    );
}
