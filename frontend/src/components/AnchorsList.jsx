/**
 * AnchorsList — sidebar list of every anchor in the current book.
 * Each row is an AnchorChip. Anchors are NOT deduped — two messages
 * that happen to share the same page and rect are distinct
 * conversations and the user may want to navigate to either one.
 */

import AnchorChip from "./AnchorChip";

export default function AnchorsList({ anchors, onClick, onDelete }) {
    const sorted = [...anchors].sort(
        (a, b) => a.anchor_page - b.anchor_page || a.created_at - b.created_at,
    );

    return (
        <div className="anchors-list" role="list">
            {sorted.length === 0 ? (
                <div className="anchors-empty">No anchors yet. Drag on a page to create one.</div>
            ) : (
                sorted.map((a) => (
                    <AnchorChip
                        key={a.message_id}
                        anchor={a}
                        onClick={onClick}
                        onDelete={onDelete}
                    />
                ))
            )}
        </div>
    );
}