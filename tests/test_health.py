"""Health + index endpoint smoke tests.

These run in milliseconds and validate that the server is up at all.
Every other test depends on this passing.
"""
from __future__ import annotations


def test_healthz_ok(http_client) -> None:
    response = http_client.get("/healthz")
    assert response.status_code == 200
    body = response.json()
    assert body == {"ok": True}


def test_index_serves_html(http_client) -> None:
    response = http_client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers.get("content-type", "")
    assert "<!DOCTYPE html>" in response.text or "<html" in response.text


def test_static_app_js_served(http_client) -> None:
    """The Vite-built bundle is at frontend/dist/app.js, served at /static/."""
    response = http_client.get("/static/dist/app.js")
    # 404 is OK if Vite hasn't built yet — but the no-cache header must be present
    # when the file does exist.
    if response.status_code == 200:
        cache_control = response.headers.get("cache-control", "")
        assert "no-cache" in cache_control.lower() or "no-store" in cache_control.lower()


def test_openapi_schema(http_client) -> None:
    """FastAPI exposes the OpenAPI schema for documentation."""
    response = http_client.get("/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    assert "paths" in schema
    # Every documented endpoint in v3 must be present
    assert "/api/pdf/load" in schema["paths"]
    assert "/api/pdfs" in schema["paths"]
    assert "/api/pdf/{pdf_hash}/file" in schema["paths"]
    assert "/api/pdf/{pdf_hash}/page/{page}.png" in schema["paths"]
    assert "/api/session/new" in schema["paths"]
    assert "/api/session/{session_id}/messages" in schema["paths"]
    assert "/api/anchor/{message_id}" in schema["paths"]
    assert "/api/chat" in schema["paths"]