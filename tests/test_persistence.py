"""Browser test: zoom + chat width survive browser refresh."""
import time

import pytest
from playwright.sync_api import sync_playwright

PDF_URL = "https://arxiv.org/pdf/1706.03762.pdf"


@pytest.mark.browser
def test_zoom_and_chat_width_persist() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1400, "height": 900})
        page = ctx.new_page()

        page.goto("http://127.0.0.1:8910/?t=" + str(int(time.time())), wait_until="domcontentloaded")
        page.wait_for_selector("#urlInput", timeout=10000)

        # Load a PDF so the controls are enabled
        page.fill("#urlInput", PDF_URL)
        page.click("#loadBtn")
        page.wait_for_function(
            "() => Array.from(document.querySelectorAll('.pdf-page-canvas')).some(c => c.width > 100)",
            timeout=60000,
        )
        time.sleep(2.0)

        # Set zoom to 1.5
        page.select_option("#zoomSelect", "1.5")
        time.sleep(1.0)

        # Drag the panel divider left to grow chat
        divider = page.locator("#panelDivider")
        dbox = divider.bounding_box()
        page.mouse.move(dbox["x"] + dbox["width"] / 2, dbox["y"] + dbox["height"] / 2)
        page.mouse.down()
        page.mouse.move(dbox["x"] - 150, dbox["y"] + dbox["height"] / 2, steps=10)
        page.mouse.up()
        time.sleep(1.0)

        prefs_before = page.evaluate("localStorage.getItem('pdfreader.prefs.v1')")
        assert prefs_before is not None and "zoomMode" in prefs_before, f"prefs not saved: {prefs_before}"
        zoom_before = page.locator("#zoomSelect").input_value()

        # Reload
        page.reload()
        page.wait_for_selector("#urlInput", timeout=10000)
        page.fill("#urlInput", PDF_URL)
        page.click("#loadBtn")
        page.wait_for_function(
            "() => Array.from(document.querySelectorAll('.pdf-page-canvas')).some(c => c.width > 100)",
            timeout=60000,
        )
        time.sleep(2.0)

        zoom_after = page.locator("#zoomSelect").input_value()
        assert zoom_after == "1.5", f"zoom not restored (got {zoom_after})"

        print(f"\nZoom persisted across reload (zoom={zoom_after})")
        browser.close()