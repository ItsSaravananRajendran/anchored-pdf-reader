"""Pytest fixtures: live server, HTTP client, Playwright browser.

`server_url` spawns uvicorn on a free port, points it at a test data dir,
and yields the base URL. Tear-down kills the process.

`http_client` gives a reusable httpx.AsyncClient bound to the server.

`playwright_page` provides a Chromium page for browser-level tests. The
fixture also tells the server which PDF hash to load.

The fixtures share the same process; they don't each spawn their own server.
"""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def test_data_dir(tmp_path_factory) -> Path:
    """Isolated data directory per test session — never touches the user's DB."""
    return tmp_path_factory.mktemp("pdf_reader_data")


@pytest.fixture(scope="session")
def server_url(test_data_dir) -> str:
    """Spawn uvicorn on a free port; yield the base URL; tear down on exit."""
    port = _free_port()
    env = {
        **os.environ,
        "MINIMAX_API_KEY": "test-key-for-pdf-reader-pytest",
        "BIND_HOST": "127.0.0.1",
        "BIND_PORT": str(port),
        "DATA_DIR": str(test_data_dir),
    }
    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "backend.app:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--log-level",
            "warning",
        ],
        cwd=str(PROJECT_ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    base = f"http://127.0.0.1:{port}"
    deadline = time.time() + 30
    while time.time() < deadline:
        try:
            r = httpx.get(f"{base}/healthz", timeout=1.0)
            if r.status_code == 200:
                break
        except Exception:
            time.sleep(0.2)
    else:
        proc.terminate()
        raise RuntimeError(f"server did not start on {base}")
    yield base
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()


@pytest.fixture(scope="module")
def http_client(server_url) -> httpx.Client:
    """Reusable HTTP client bound to the live server. Module scope so
    fixtures like `loaded_pdf` (also module-scoped) can depend on it."""
    with httpx.Client(base_url=server_url, timeout=30.0) as client:
        yield client


@pytest.fixture(scope="session")
def playwright_session():
    """A single Playwright Chromium browser for the whole session."""
    # Lazy import so tests that don't use Playwright don't pay the cost
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        yield browser
        browser.close()


@pytest.fixture
def page(playwright_session):
    """A fresh Chromium context+page per test, with stable viewport."""
    ctx = playwright_session.new_context(viewport={"width": 1400, "height": 900})
    page = ctx.new_page()
    yield page
    ctx.close()