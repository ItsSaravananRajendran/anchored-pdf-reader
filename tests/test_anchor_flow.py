"""Browser test: drag → ask → reload preserves the anchor in the sidebar."""
import time

import pytest
from playwright.sync_api import sync_playwright

PDF_URL = "https://arxiv.org/pdf/1706.03762.pdf"


@pytest.mark.browser
def test_drag_ask_reload_persistence() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1400, "height": 900})
        page = ctx.new_page()

        page.goto("http://127.0.0.1:8910/?t=" + str(int(time.time())), wait_until="domcontentloaded")
        page.wait_for_selector("#urlInput", timeout=10000)
        page.fill("#urlInput", PDF_URL)
        page.click("#loadBtn")
        page.wait_for_function(
            "() => Array.from(document.querySelectorAll('.pdf-page-canvas')).some(c => c.width > 100)",
            timeout=60000,
        )
        time.sleep(2.0)

        # Drag a rectangle
        overlay = page.locator(".pdf-page-overlay").first
        box = overlay.bounding_box()
        page.mouse.move(box["x"] + 50, box["y"] + 50)
        page.mouse.down()
        page.mouse.move(box["x"] + 300, box["y"] + 200, steps=10)
        page.mouse.up()
        time.sleep(1.5)

        assert page.locator(".pending-preview").count() > 0, "pending anchor not set after drag"

        # Type a question
        page.fill(".composer-input", "Summarize the abstract")
        page.click(".composer .btn.primary")
        time.sleep(8.0)

        n_anchors = page.locator(".anchor-row").count()
        assert n_anchors >= 1, f"no anchors in sidebar (found {n_anchors})"

        # Reload and verify the anchor is still there
        page.reload()
        page.wait_for_selector("#urlInput", timeout=10000)
        page.fill("#urlInput", PDF_URL)
        page.click("#loadBtn")
        page.wait_for_function(
            "() => Array.from(document.querySelectorAll('.pdf-page-canvas')).some(c => c.width > 100)",
            timeout=60000,
        )
        time.sleep(2.0)
        n_after_reload = page.locator(".anchor-row").count()
        assert n_after_reload >= 1, f"anchor disappeared after reload (found {n_after_reload})"

        print(f"\nAnchor persisted across reload ({n_after_reload} in sidebar)")
        browser.close()