"""Regression test: assistant reply text appears during SSE streaming.

Bug: useSendMessage.onToken expected (chunk, accumulated) but streamChat
passes only (chunk). So msg.text was set to undefined on every token and
MessageBubble rendered an empty body. The assistant message appeared with
the "streaming" status but no visible text.

This test sends a question, waits for the assistant bubble to be marked
"complete", and asserts the bubble's body text is non-empty.
"""
import time

import pytest
from playwright.sync_api import sync_playwright

PDF_URL = "https://arxiv.org/pdf/1706.03762.pdf"


@pytest.mark.browser
def test_anchor_send_streams_assistant_text() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1400, "height": 900})
        page = ctx.new_page()
        page.goto("http://127.0.0.1:8910/?t=" + str(int(time.time())), wait_until="domcontentloaded")
        page.wait_for_selector("#urlInput", timeout=10000)
        page.fill("#urlInput", PDF_URL)
        page.click("#loadBtn")
        page.wait_for_function(
            "() => Array.from(document.querySelectorAll('canvas.pdf-page-canvas')).some(c => c.width > 100)",
            timeout=120000,
        )
        time.sleep(2.0)

        # Drag a unique rect on the page overlay (avoid coords that overlap
        # existing anchors, otherwise AnchorsList dedupes the new one out).
        overlay = page.locator(".pdf-page-overlay").first
        box = overlay.bounding_box()
        assert box is not None, "overlay not visible"
        start_x = box["x"] + 80
        start_y = box["y"] + 300
        page.mouse.move(start_x, start_y)
        page.mouse.down()
        for i in range(1, 11):
            page.mouse.move(start_x + i * 15, start_y + i * 8)
            time.sleep(0.02)
        page.mouse.up()
        time.sleep(1.0)

        assert page.locator(".pending-preview").count() > 0, "drag did not set pending anchor"

        page.fill(".composer-input", "Summarize the visible region in one sentence.")
        page.click(".composer .btn.primary")

        # Wait for the assistant message to be marked complete (SSE done event)
        page.wait_for_function(
            "() => Array.from(document.querySelectorAll('.message.assistant')).some(m => m.className.includes('complete'))",
            timeout=60000,
        )

        # The body text should be non-empty (the bug rendered an empty body)
        body_text = page.evaluate("""() => {
            const msgs = document.querySelectorAll('.message.assistant .message-body');
            return Array.from(msgs).map(m => m.textContent.trim());
        }""")
        assert any(len(t) > 20 for t in body_text), (
            f"assistant body empty after SSE complete (got {body_text!r})"
        )

        # Also: the new anchor should appear in the sidebar (the new
        # rect's key doesn't collide with existing ones because we dragged
        # at a fresh position).
        time.sleep(2.0)  # onAfterSend → refreshBookAnchors
        chip_count = page.locator(".anchor-row").count()
        assert chip_count >= 1, "no anchor chips in sidebar after send"
