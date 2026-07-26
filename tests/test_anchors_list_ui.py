"""Regression test for the v3.2 AnchorsList UI redesign.

Covers the 5 spec assertions:
  (a) the new .anchors-toggle button is present with aria-expanded="true"
  (b) the .anchor-row no longer contains .anchor-thumb
  (c) clicking the toggle hides the list and re-clicking restores it
  (d) clicking a row navigates to the anchor's page
  (e) the count is shown in the header
"""
import time

import pytest
from playwright.sync_api import sync_playwright

PDF_URL = "https://arxiv.org/pdf/1706.03762.pdf"


@pytest.mark.browser
def test_anchors_list_collapsible_and_clean() -> None:
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

        # (a) toggle is present and expanded
        toggle = page.locator(".anchors-toggle")
        assert toggle.count() == 1, "anchors-toggle button missing"
        assert toggle.get_attribute("aria-expanded") == "true", "toggle should default to expanded"
        assert toggle.get_attribute("aria-controls"), "toggle should have aria-controls"

        # (b) thumb removed
        assert page.locator(".anchor-thumb").count() == 0, "anchor-thumb should be removed"

        # rows show badge + text (no thumb column)
        rows = page.locator(".anchor-row")
        assert rows.count() >= 1, "expected at least one anchor row"
        first = rows.first
        assert first.locator(".page-badge").count() == 1
        assert first.locator(".anchor-text").count() == 1

        # (e) count is in the header
        label = toggle.text_content() or ""
        assert "Anchors in this book" in label
        assert "(" in label and ")" in label, f"count not in header: {label!r}"

        # (c) collapse: click toggle, assert aria-expanded=false and max-height=0
        toggle.click()
        time.sleep(0.3)
        assert toggle.get_attribute("aria-expanded") == "false", "toggle should be collapsed"
        collapse = page.locator(".anchors-collapse")
        assert collapse.get_attribute("aria-hidden") == "true", "collapse region should be aria-hidden"
        max_h = page.evaluate("() => getComputedStyle(document.querySelector('.anchors-collapse')).maxHeight")
        assert max_h == "0px", f"max-height should be 0 when collapsed, got {max_h}"

        # re-expand
        toggle.click()
        time.sleep(0.3)
        assert toggle.get_attribute("aria-expanded") == "true"
        max_h = page.evaluate("() => getComputedStyle(document.querySelector('.anchors-collapse')).maxHeight")
        assert max_h == "280px", f"max-height should be 280 when expanded, got {max_h}"

        # (d) click first row → navigates to that page
        first_badge_text = first.locator(".page-badge").text_content() or ""
        # "p.1" → 1
        target_page = int(first_badge_text.replace("p.", "").strip())
        first.click()
        page.wait_for_function(
            f"() => document.querySelector('.page-indicator')?.textContent.replace(/\\s+/g, '').startsWith('{target_page}')",
            timeout=5000,
        )
        time.sleep(0.5)
        data_page = page.locator("[data-page]").first.get_attribute("data-page")
        assert data_page == str(target_page), f"expected data-page={target_page}, got {data_page}"
