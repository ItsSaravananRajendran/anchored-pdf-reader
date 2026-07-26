/**
 * AnchorChip — small rectangle thumbnail + page badge. Click to load the
 * session it came from. Hover reveals a delete (×) button.
 */

import { useState } from "react";
import { rectsEqual } from "../lib/rect";
import { truncate } from "../lib/utils";

export default function AnchorChip({ anchor, onClick, onDelete }) {
    const [hovered, setHovered] = useState(false);
    const style = {
        left: `${anchor.anchor_rect.x * 100}%`,
        top: `${anchor.anchor_rect.y * 100}%`,
        width: `${anchor.anchor_rect.w * 100}%`,
        height: `${anchor.anchor_rect.h * 100}%`,
    };

    return (
        <div
            className={`anchor-row ${hovered ? "hovered" : ""}`}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={() => onClick(anchor)}
            role="button"
            tabIndex={0}
        >
            <div className="anchor-thumb" style={style} />
            <span className="page-badge">p.{anchor.anchor_page}</span>
            <div className="anchor-text">
                {anchor.role === "user" ? "Q:" : "A:"} {truncate(anchor.text || "(no text)", 60)}
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