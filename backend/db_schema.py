"""SQLite connection and schema.

Owns: the database path (delegated to settings), the connection context
manager, the schema DDL, and `init_db`. Pure data-layer plumbing — no
query helpers live here; those belong in db_repos.
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager

from . import settings


SCHEMA = """
CREATE TABLE IF NOT EXISTS pdf (
    hash        TEXT PRIMARY KEY,
    url         TEXT NOT NULL,
    bytes       INTEGER NOT NULL,
    page_count  INTEGER,
    title       TEXT,
    path        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pdf_text_cache (
    pdf_hash     TEXT NOT NULL,
    page         INTEGER NOT NULL,
    text         TEXT,
    has_text     INTEGER NOT NULL,
    extracted_at INTEGER NOT NULL,
    PRIMARY KEY (pdf_hash, page),
    FOREIGN KEY (pdf_hash) REFERENCES pdf(hash)
);

CREATE TABLE IF NOT EXISTS session (
    id          TEXT PRIMARY KEY,
    pdf_hash    TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    FOREIGN KEY (pdf_hash) REFERENCES pdf(hash)
);

CREATE TABLE IF NOT EXISTS message (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL,
    role            TEXT NOT NULL,
    text            TEXT NOT NULL,
    anchor_page     INTEGER,
    anchor_rect     TEXT,
    anchor_rotation INTEGER,
    status          TEXT NOT NULL DEFAULT 'complete',
    error_kind      TEXT,
    created_at      INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES session(id)
);

CREATE INDEX IF NOT EXISTS idx_message_session_created
    ON message(session_id, created_at);
"""


def init_db() -> None:
    settings.DATA_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(settings.SQLITE_PATH) as connection:
        connection.executescript(SCHEMA)
        connection.commit()


@contextmanager
def conn():
    connection = sqlite3.connect(settings.SQLITE_PATH, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    try:
        yield connection
    finally:
        connection.close()