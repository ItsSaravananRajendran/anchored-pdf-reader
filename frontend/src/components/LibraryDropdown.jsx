/**
 * LibraryDropdown — pick from cached PDFs.
 */

import { useState, useRef, useEffect } from "react";

export default function LibraryDropdown({ library, onPick }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        function onDoc(e) {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        }
        document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
    }, [open]);

    return (
        <div className="library-dropdown" ref={ref}>
            <button
                className="btn ghost"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-haspopup="listbox"
            >
                Library ▾
            </button>
            {open && (
                <div className="library-menu" role="listbox">
                    {library.length === 0 ? (
                        <div className="library-empty">No PDFs loaded yet</div>
                    ) : (
                        library.map((item) => (
                            <button
                                key={item.pdf_hash}
                                className="library-item"
                                onClick={() => { onPick(item.pdf_hash); setOpen(false); }}
                                role="option"
                                aria-selected="false"
                            >
                                <div className="library-item-title">{item.title || "Untitled"}</div>
                                <div className="library-item-meta">
                                    {item.page_count} pages · {item.message_count} messages
                                </div>
                            </button>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}