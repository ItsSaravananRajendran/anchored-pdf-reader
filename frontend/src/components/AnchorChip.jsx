/**
 * AnchorChip — a single anchor in the sidebar list. Click to load the
 * session it came from. Hover reveals a delete (×) button.
 *
 * Layout: [page-badge] [text (Q/A + truncated message)] [delete on hover]
 * No thumbnail — the user wanted a clean text-only row.
 */

import { useState } from "react";
import { truncate } from "../lib/utils";

const ROLE_LABEL = { user: "Q", assistant: "A" };
const ROLE_CLASS = { user: "user", assistant: "assistant" };

export default function AnchorChip({ anchor, onClick, onDelete }) {
    const [hovered, setHovered] = useState(false);

    return (
        <div
            className={`anchor-row ${hovered ? "hovered" : ""} ${ROLE_CLASS[anchor.role] || ""}`}
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
                <span className={`anchor-role ${ROLE_CLASS[anchor.role] || ""}`}>
                    {ROLE_LABEL[anchor.role] || "·"}
                </span>
                {" "}
                {truncate(anchor.text || "(no text)", 60)}
            </div>
            {onDelete && (
                <button
                    className="anchor-delete"
                    onClick={(e) => {
                        e.stopPropagation();
                        if (confirm("Delete this question and its answer? This cannot be undone.")) {
                            onDelete(anchor);
                        }
                    }}
                    aria-label="Delete anchor"
                    title="Delete anchor"
                >
                    ×
                </button>
            )}
        </div>
    );
}
