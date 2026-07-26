"""CRUD helpers for each table.

Each function is a single, focused operation. They use the `conn()` context
manager from db_schema. No FastAPI / HTTP types here — these are pure data
access, callable from anywhere.
"""
from __future__ import annotations

import json
import time
from typing import Optional

from .db_schema import conn


# ---- PDF -----------------------------------------------------------

def upsert_pdf(
    hash_: str,
    url: str,
    bytes_: int,
    path: str,
    page_count: Optional[int],
    title: Optional[str],
) -> None:
    with conn() as c:
        c.execute(
            """INSERT INTO pdf(hash, url, bytes, page_count, title, path, created_at)
               VALUES(?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(hash) DO UPDATE SET
                   url=excluded.url,
                   bytes=excluded.bytes,
                   page_count=COALESCE(excluded.page_count, pdf.page_count),
                   title=COALESCE(excluded.title, pdf.title),
                   path=excluded.path""",
            (hash_, url, bytes_, page_count, title, path, int(time.time())),
        )


def get_pdf(hash_: str):
    with conn() as c:
        return c.execute("SELECT * FROM pdf WHERE hash=?", (hash_,)).fetchone()


def get_page_text(pdf_hash: str, page: int) -> tuple:
    """Returns (text or None, has_text).
    has_text is True only when an extracted non-empty text exists.
    A missing cache row returns (None, False).
    """
    with conn() as c:
        row = c.execute(
            "SELECT text, has_text FROM pdf_text_cache WHERE pdf_hash=? AND page=?",
            (pdf_hash, page),
        ).fetchone()
        if row is None:
            return None, False
        return row["text"], bool(row["has_text"])


def _page_text_exists(pdf_hash: str, page: int) -> bool:
    with conn() as c:
        row = c.execute(
            "SELECT 1 FROM pdf_text_cache WHERE pdf_hash=? AND page=?",
            (pdf_hash, page),
        ).fetchone()
        return row is not None


def set_page_text(pdf_hash: str, page: int, text: Optional[str], has_text: bool) -> None:
    with conn() as c:
        c.execute(
            """INSERT INTO pdf_text_cache(pdf_hash, page, text, has_text, extracted_at)
               VALUES(?, ?, ?, ?, ?)
               ON CONFLICT(pdf_hash, page) DO UPDATE SET
                   text=excluded.text,
                   has_text=excluded.has_text,
                   extracted_at=excluded.extracted_at""",
            (pdf_hash, page, text, int(has_text), int(time.time())),
        )


# ---- Session -------------------------------------------------------

def create_session(session_id: str, pdf_hash: str) -> None:
    with conn() as c:
        c.execute(
            "INSERT INTO session(id, pdf_hash, created_at) VALUES(?, ?, ?)",
            (session_id, pdf_hash, int(time.time())),
        )


def get_session(session_id: str):
    with conn() as c:
        return c.execute("SELECT * FROM session WHERE id=?", (session_id,)).fetchone()


def delete_session(session_id: str) -> None:
    with conn() as c:
        c.execute("DELETE FROM message WHERE session_id=?", (session_id,))
        c.execute("DELETE FROM session WHERE id=?", (session_id,))


# ---- Message -------------------------------------------------------

def add_message(
    msg_id: str,
    session_id: str,
    role: str,
    text: str,
    anchor_page: Optional[int] = None,
    anchor_rect: Optional[dict] = None,
    anchor_rotation: Optional[int] = None,
    status: str = "complete",
    error_kind: Optional[str] = None,
) -> None:
    with conn() as c:
        c.execute(
            """INSERT INTO message(id, session_id, role, text, anchor_page, anchor_rect,
                                    anchor_rotation, status, error_kind, created_at)
               VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                msg_id, session_id, role, text, anchor_page,
                json.dumps(anchor_rect) if anchor_rect else None,
                anchor_rotation, status, error_kind,
                int(time.time() * 1000),
            ),
        )


def update_message_text(
    msg_id: str,
    text: str,
    status: str = "complete",
    error_kind: Optional[str] = None,
) -> None:
    with conn() as c:
        c.execute(
            "UPDATE message SET text=?, status=?, error_kind=? WHERE id=?",
            (text, status, error_kind, msg_id),
        )


def list_messages(session_id: str):
    with conn() as c:
        return c.execute(
            "SELECT * FROM message WHERE session_id=? ORDER BY created_at ASC",
            (session_id,),
        ).fetchall()


def delete_message(message_id: str) -> int:
    """Delete a single message by id. Returns the number of rows deleted."""
    with conn() as c:
        cur = c.execute("DELETE FROM message WHERE id=?", (message_id,))
        return cur.rowcount


def delete_anchor_for_message(message_id: str) -> int:
    """Delete the entire anchor pair: the user question and its assistant reply.
    Identifies the pair by shared session_id + (page, rect, rotation)."""
    with conn() as c:
        row = c.execute(
            "SELECT session_id, anchor_page, anchor_rect, anchor_rotation, role "
            "FROM message WHERE id=?",
            (message_id,),
        ).fetchone()
        if row is None:
            return 0
        if row["anchor_page"] is None:
            return delete_message(message_id)
        cur = c.execute(
            """DELETE FROM message
               WHERE session_id = ?
                 AND anchor_page = ?
                 AND anchor_rect = ?
                 AND anchor_rotation = ?
                 AND (id = ? OR role != ?)""",
            (
                row["session_id"], row["anchor_page"], row["anchor_rect"],
                row["anchor_rotation"], message_id, row["role"],
            ),
        )
        return cur.rowcount


# ---- Library -------------------------------------------------------

def list_pdfs():
    with conn() as c:
        return c.execute(
            """SELECT p.hash, p.url, p.title, p.page_count, p.bytes, p.created_at,
                      (SELECT MAX(s.created_at) FROM session s WHERE s.pdf_hash=p.hash) AS last_session_at,
                      (SELECT COUNT(*) FROM session s WHERE s.pdf_hash=p.hash) AS session_count,
                      (SELECT COUNT(*) FROM message m JOIN session s ON m.session_id=s.id
                       WHERE s.pdf_hash=p.hash) AS message_count
               FROM pdf p
               ORDER BY COALESCE(
                 (SELECT MAX(s.created_at) FROM session s WHERE s.pdf_hash=p.hash),
                 p.created_at
               ) DESC"""
        ).fetchall()


def list_anchors_for_pdf(pdf_hash):
    """All distinct anchors for a book across all sessions, with the latest message id
    that used them. Used by the library to redraw rectangles on reopen."""
    with conn() as c:
        rows = c.execute(
            """SELECT m.id AS message_id, m.session_id, m.anchor_page, m.anchor_rect,
                      m.anchor_rotation, m.role, m.text, m.created_at
               FROM message m
               JOIN session s ON m.session_id = s.id
               WHERE s.pdf_hash = ?
                 AND m.anchor_page IS NOT NULL
                 AND m.anchor_rect IS NOT NULL
               ORDER BY m.anchor_page ASC, m.created_at ASC""",
            (pdf_hash,),
        ).fetchall()
    return [
        {
            "message_id": r["message_id"],
            "session_id": r["session_id"],
            "role": r["role"],
            "anchor_page": r["anchor_page"],
            "anchor_rect": json.loads(r["anchor_rect"]) if r["anchor_rect"] else None,
            "anchor_rotation": r["anchor_rotation"],
            "text": r["text"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]