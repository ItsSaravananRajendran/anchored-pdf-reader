/**
 * AnchorsList — sidebar list of every anchor in the current book.
 * Dedupes by (page, rect). Each row is an AnchorChip.
 */

import { useMemo } from "react";
import AnchorChip from "./AnchorChip";

export default function AnchorsList({ anchors, onClick, onDelete }) {
    const deduped = useMemo(() => {
        const seen = new Map();
        for (const a of anchors) {
            const key = `${a.anchor_page}-${JSON.stringify(a.anchor_rect)}`;
            if (!seen.has(key)) seen.set(key, a);
        }
        return Array.from(seen.values()).sort(
            (a, b) => a.anchor_page - b.anchor_page || a.created_at - b.created_at,
        );
    }, [anchors]);

    return (
        <div className="anchors-list" role="list">
            {deduped.length === 0 ? (
                <div className="anchors-empty">No anchors yet. Drag on a page to create one.</div>
            ) : (
                deduped.map((a) => (
                    <AnchorChip
                        key={`${a.anchor_page}-${a.message_id}`}
                        anchor={a}
                        onClick={onClick}
                        onDelete={onDelete}
                    />
                ))
            )}
        </div>
    );
}