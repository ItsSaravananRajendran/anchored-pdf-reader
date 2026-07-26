"""Browser test: 500-page book stays within a virtual-render budget."""
import time

import pytest
from playwright.sync_api import sync_playwright

PDF_URL = "https://mml-book.github.io/book/mml-book.pdf"


@pytest.mark.browser
def test_500page_virtual_render_budget() -> None:
    """A 500-page book must keep at most 11 canvases in memory."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1400, "height": 900})
        page = ctx.new_page()

        page.goto("http://127.0.0.1:8910/?t=" + str(int(time.time())), wait_until="domcontentloaded")
        page.wait_for_selector("#urlInput", timeout=10000)
        page.fill("#urlInput", PDF_URL)
        page.click("#loadBtn")

        # Wait for at least one canvas to render (use the .reader-scroll class)
        page.wait_for_function(
            "() => Array.from(document.querySelectorAll('.pdf-page-canvas')).some(c => c.width > 100)",
            timeout=180000,  # big PDF, generous timeout
        )
        time.sleep(5.0)

        # Filter by canvas width > 500 — default canvas width is 300 (HTML spec);
        # only rendered canvases have width = viewport.width * dpr (typically 800+).
        n_rendered = page.evaluate("""() => {
          return Array.from(document.querySelectorAll('.pdf-page-canvas'))
            .filter(c => c.width > 500).length;
        }""")
        assert n_rendered <= 11, f"too many rendered initially: {n_rendered}"
        print(f"\nInitial rendered: {n_rendered} (expected ≤ 11)")

        # Scroll to the middle
        page.evaluate("document.querySelector('.reader-scroll').scrollTop = 200000")
        time.sleep(3.0)
        n_after = page.evaluate("""() => {
          return Array.from(document.querySelectorAll('.pdf-page-canvas'))
            .filter(c => c.width > 500).length;
        }""")
        assert n_after <= 11, f"too many rendered after scroll: {n_after}"
        print(f"After scroll rendered: {n_after} (expected ≤ 11)")

        browser.close()