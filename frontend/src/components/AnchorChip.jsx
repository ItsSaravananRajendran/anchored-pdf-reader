/**
 * AnchorChip — one row per anchor question in the sidebar.
 * Click anywhere on the row to navigate to that anchor's session.
 * Hover reveals a delete (×) button on the right.
 *
 * Layout: badge | question (2-line max, ellipsised) | delete
 * (v3.2: dropped the 32x32 thumbnail; the row is a quiet one-liner now.)
 */

import { useState } from "react";
import { truncate } from "../lib/utils";

export default function AnchorChip({ anchor, onClick, onDelete }) {
    const [hovered, setHovered] = useState(false);

    function handleRowClick() {
        if (onClick) onClick(anchor);
    }

    function handleRowKey(e) {
        // Only the row itself activates navigation. The nested <button>
        // children (e.g. the delete × button) handle their own keys and
        // would otherwise double-fire (delete + navigate on a single press).
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleRowClick();
        }
    }

    function handleDelete(e) {
        e.stopPropagation();
        if (!onDelete) return;
        if (confirm("Delete this question and its answer? This cannot be undone.")) {
            onDelete(anchor);
        }
    }

    return (
        <li
            className={`anchor-row ${hovered ? "hovered" : ""}`}
            onClick={handleRowClick}
            onKeyDown={handleRowKey}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            role="button"
            tabIndex={0}
            aria-label={`Anchor on page ${anchor.anchorPage}: ${truncate(anchor.question || "", 80)}`}
        >
            <span className="page-badge">p.{anchor.anchorPage}</span>
            <span className="anchor-text">
                {truncate(anchor.question || "(no question)", 200)}
            </span>
            {onDelete && (
                <button
                    className="anchor-delete"
                    onClick={handleDelete}
                    aria-label="Delete anchor"
                    title="Delete anchor"
                    type="button"
                >
                    ×
                </button>
            )}
        </li>
    );
}
