"""Backwards-compatible database access.

This module re-exports everything from db_schema and db_repos so existing
imports (`db.get_pdf`, `db.upsert_pdf`, etc.) keep working after the split.
New code should import from the specific submodule it needs:
    from .db_schema import conn, init_db
    from .db_repos import get_pdf, upsert_pdf, ...
"""
from .db_schema import SCHEMA, conn, init_db
from .db_repos import (
    add_message,
    create_session,
    delete_anchor_for_message,
    delete_message,
    delete_session,
    get_page_text,
    get_pdf,
    get_session,
    last_message_with_anchor,
    list_anchors_for_pdf,
    list_messages,
    list_pdfs,
    set_page_text,
    update_message_text,
    upsert_pdf,
)

__all__ = [
    "SCHEMA",
    "conn",
    "init_db",
    "add_message",
    "create_session",
    "delete_anchor_for_message",
    "delete_message",
    "delete_session",
    "get_page_text",
    "get_pdf",
    "get_session",
    "list_anchors_for_pdf",
    "list_messages",
    "list_pdfs",
    "set_page_text",
    "update_message_text",
    "upsert_pdf",
]