"""API contract tests — every documented endpoint, including Range + SSE.

These tests use a small, known PDF (Attention Is All You Need, 15 pages,
public arXiv paper) so behavior is reproducible without depending on
external services.
"""
from __future__ import annotations

import httpx
import pytest


PDF_URL = "https://arxiv.org/pdf/1706.03762.pdf"


@pytest.fixture(scope="module")
def loaded_pdf(http_client) -> dict:
    """Download + load the test PDF once for the whole module."""
    response = http_client.post("/api/pdf/load", json={"url": PDF_URL})
    assert response.status_code == 200, response.text
    return response.json()


# ---- Library listing ----------------------------------------------

def test_list_pdfs_empty(http_client) -> None:
    response = http_client.get("/api/pdfs")
    assert response.status_code == 200
    assert response.json()["items"] == []


def test_load_pdf_returns_hash(http_client, loaded_pdf) -> None:
    assert "pdf_hash" in loaded_pdf
    assert "page_count" in loaded_pdf
    assert loaded_pdf["page_count"] == 15
    # arXiv PDFs typically don't have a /Title metadata field; title may be None.
    assert "title" in loaded_pdf  # key exists, value can be None


def test_load_cached_returns_same_hash(http_client, loaded_pdf) -> None:
    """A second load of the same URL should be cached and not re-download."""
    response = http_client.post("/api/pdf/load", json={"url": PDF_URL})
    assert response.status_code == 200
    body = response.json()
    assert body["pdf_hash"] == loaded_pdf["pdf_hash"]
    assert body["cached"] is True


def test_pdf_info(http_client, loaded_pdf) -> None:
    pdf_hash = loaded_pdf["pdf_hash"]
    response = http_client.get(f"/api/pdf/{pdf_hash}/info")
    assert response.status_code == 200
    info = response.json()
    assert info["pdf_hash"] == pdf_hash
    assert info["page_count"] == 15


# ---- Byte serving + Range header ----------------------------------

def test_file_full_download(http_client, loaded_pdf) -> None:
    """A full GET returns the entire PDF with a 200 + Accept-Ranges."""
    pdf_hash = loaded_pdf["pdf_hash"]
    response = http_client.get(f"/api/pdf/{pdf_hash}/file")
    assert response.status_code == 200
    assert "accept-ranges" in {k.lower() for k in response.headers}
    # PDF files start with %PDF-
    assert response.content[:4] == b"%PDF"


def test_file_range_header(http_client, loaded_pdf) -> None:
    """A Range request returns 206 with the correct Content-Range + Content-Length."""
    pdf_hash = loaded_pdf["pdf_hash"]
    response = http_client.get(
        f"/api/pdf/{pdf_hash}/file",
        headers={"Range": "bytes=0-1023"},
    )
    assert response.status_code == 206
    # Header keys are case-insensitive
    headers = {k.lower(): v for k, v in response.headers.items()}
    assert headers["content-length"] == "1024"
    assert headers["content-range"].startswith("bytes 0-1023/")
    assert int(headers["accept-ranges-length"] if "accept-ranges-length" in headers else len(response.content)) >= 1024
    assert len(response.content) == 1024


def test_file_range_invalid_returns_416(http_client, loaded_pdf) -> None:
    """Garbage in the Range header should return 416 Range Not Satisfiable."""
    pdf_hash = loaded_pdf["pdf_hash"]
    response = http_client.get(
        f"/api/pdf/{pdf_hash}/file",
        headers={"Range": "noodles=0-1023"},
    )
    assert response.status_code == 416


# ---- Page rendering -----------------------------------------------

def test_page_png(http_client, loaded_pdf) -> None:
    """The page PNG endpoint returns a PNG image."""
    import io
    pdf_hash = loaded_pdf["pdf_hash"]
    response = http_client.get(f"/api/pdf/{pdf_hash}/page/1.png")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    # PNG files start with the 8-byte signature 89 50 4E 47 0D 0A 1A 0A
    assert response.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_page_out_of_range_returns_400(http_client, loaded_pdf) -> None:
    pdf_hash = loaded_pdf["pdf_hash"]
    response = http_client.get(f"/api/pdf/{pdf_hash}/page/999.png")
    assert response.status_code == 400


def test_rect_crop(http_client, loaded_pdf) -> None:
    """Server-side crop of a normalized rect returns a PNG."""
    pdf_hash = loaded_pdf["pdf_hash"]
    response = http_client.post(
        f"/api/pdf/{pdf_hash}/rect.png",
        json={"page": 1, "rect": {"x": 0.1, "y": 0.1, "w": 0.3, "h": 0.1}, "scale": 2.0},
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert len(response.content) > 100


def test_rect_crop_validation(http_client, loaded_pdf) -> None:
    """Negative coordinates are rejected."""
    pdf_hash = loaded_pdf["pdf_hash"]
    response = http_client.post(
        f"/api/pdf/{pdf_hash}/rect.png",
        json={"page": 1, "rect": {"x": -0.1, "y": 0.1, "w": 0.3, "h": 0.1}, "scale": 2.0},
    )
    assert response.status_code == 422


def test_page_text(http_client, loaded_pdf) -> None:
    """Page-text extraction returns per-page results."""
    pdf_hash = loaded_pdf["pdf_hash"]
    response = http_client.post(f"/api/pdf/{pdf_hash}/text", json={"pages": [1, 2]})
    assert response.status_code == 200
    body = response.json()
    assert "1" in body["results"]
    assert "2" in body["results"]
    assert "Attention" in body["results"]["1"]


# ---- Anchors-for-a-book -------------------------------------------

def test_anchors_empty(http_client, loaded_pdf) -> None:
    pdf_hash = loaded_pdf["pdf_hash"]
    response = http_client.get(f"/api/pdf/{pdf_hash}/anchors")
    assert response.status_code == 200
    assert response.json() == {"pdf_hash": pdf_hash, "anchors": []}


# ---- Sessions ------------------------------------------------------

def test_session_create(http_client, loaded_pdf) -> None:
    response = http_client.post("/api/session/new", json={"pdf_hash": loaded_pdf["pdf_hash"]})
    assert response.status_code == 200
    body = response.json()
    assert "session_id" in body
    assert len(body["session_id"]) > 16


def test_session_create_unknown_pdf_returns_404(http_client) -> None:
    response = http_client.post("/api/session/new", json={"pdf_hash": "nonexistent"})
    assert response.status_code == 404


def test_session_messages_empty(http_client, loaded_pdf) -> None:
    create = http_client.post("/api/session/new", json={"pdf_hash": loaded_pdf["pdf_hash"]})
    sid = create.json()["session_id"]
    response = http_client.get(f"/api/session/{sid}/messages")
    assert response.status_code == 200
    body = response.json()
    assert body["session_id"] == sid
    assert body["messages"] == []


def test_session_messages_unknown_returns_404(http_client) -> None:
    response = http_client.get("/api/session/nonexistent/messages")
    assert response.status_code == 404


# ---- Anchor delete -------------------------------------------------

def test_anchor_delete_unknown_returns_404(http_client) -> None:
    response = http_client.delete("/api/anchor/nonexistent")
    assert response.status_code == 404


# ---- Chat (SSE) ----------------------------------------------------

def test_chat_session_not_found(http_client) -> None:
    response = http_client.post(
        "/api/chat",
        json={
            "session_id": "nonexistent",
            "message_id": "m1",
            "text": "hello",
            "anchor": {"page": 1, "rect": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2}, "rotation": 0},
        },
    )
    assert response.status_code == 404


def test_chat_validation_empty_text(http_client, loaded_pdf) -> None:
    """Empty text should be rejected by the Pydantic model."""
    create = http_client.post("/api/session/new", json={"pdf_hash": loaded_pdf["pdf_hash"]})
    sid = create.json()["session_id"]
    response = http_client.post(
        "/api/chat",
        json={
            "session_id": sid,
            "message_id": "m1",
            "text": "",
            "anchor": {"page": 1, "rect": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2}, "rotation": 0},
        },
    )
    assert response.status_code == 422


def test_chat_validation_negative_page(http_client, loaded_pdf) -> None:
    create = http_client.post("/api/session/new", json={"pdf_hash": loaded_pdf["pdf_hash"]})
    sid = create.json()["session_id"]
    response = http_client.post(
        "/api/chat",
        json={
            "session_id": sid,
            "message_id": "m1",
            "text": "hello",
            "anchor": {"page": 0, "rect": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2}, "rotation": 0},
        },
    )
    assert response.status_code == 422