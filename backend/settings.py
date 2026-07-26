"""Centralized settings — every env read lives here.

Importing this module fails loudly if a required variable is missing.
This catches typos and missing config at process start, not in the middle of
handling a request.
"""
from __future__ import annotations

import os
from pathlib import Path


def _require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"required environment variable {name!r} is not set")
    return value


def _optional_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise RuntimeError(f"environment variable {name} must be an integer, got {raw!r}") from exc


# --- Required for production ---
MINIMAX_API_KEY: str = _require("MINIMAX_API_KEY")

# --- Network binding ---
BIND_HOST: str = os.environ.get("BIND_HOST", "0.0.0.0")
BIND_PORT: int = _optional_int("BIND_PORT", 8910)

# --- Paths ---
BACKEND_DIR: Path = Path(__file__).resolve().parent
PROJECT_ROOT: Path = BACKEND_DIR.parent
DATA_DIR: Path = Path(os.environ.get("DATA_DIR", str(PROJECT_ROOT / "data")))
FRONTEND_DIR: Path = PROJECT_ROOT / "frontend"
PDF_CACHE_DIR: Path = DATA_DIR / "pdfs"
SQLITE_PATH: Path = DATA_DIR / "app.db"

DATA_DIR.mkdir(parents=True, exist_ok=True)
PDF_CACHE_DIR.mkdir(parents=True, exist_ok=True)

# --- Limits ---
PDF_MAX_BYTES: int = _optional_int("PDF_MAX_BYTES", 50 * 1024 * 1024)  # 50 MB
PAGE_TEXT_MAX_CHARS: int = _optional_int("PAGE_TEXT_MAX_CHARS", 8000)