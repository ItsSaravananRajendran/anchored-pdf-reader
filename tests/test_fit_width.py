"""Regression test for fit-width zoom filling the reader pane.

Three failures the test guards against:
  1. The scrollContainerRef was never attached to a DOM node, so the
     fit-width scale never recomputed (canvas stayed at native 612px
     regardless of the dropdown selection).
  2. The wrap was 204px wider than the canvas because Reader.jsx
     hand-rolled `612 * 96/72 * scale` while PDF.js's getViewport()
     already does the 96/72 conversion (double-counted DPI).
  3. The default zoom was 1.0, leaving ~330px of blank space to the
     right of the canvas in a ~942px reader pane on first load.
"""
import time

import pytest
from playwright.sync_api import sync_playwright

PDF_URL = "https://arxiv.org/pdf/1706.03762.pdf"


@pytest.mark.browser
def test_default_zoom_fits_width_and_reactive() -> None:
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

        # (1) Default zoom is fit-width
        zoom = page.evaluate("() => document.getElementById('zoomSelect')?.value")
        assert zoom == "fit-width", f"default zoom should be fit-width, got {zoom}"

        # (2) The wrap is no wider than the canvas (the 96/72 double-count
        #     used to leave 204px of dead space inside the wrap).
        sizes = page.evaluate("""() => {
            const c = document.querySelector('canvas.pdf-page-canvas');
            const w = document.querySelector('.pdf-page-wrap');
            return {
                wrapW: w?.getBoundingClientRect().width,
                canvasW: c?.getBoundingClientRect().width,
            };
        }""")
        wrapW = sizes["wrapW"] or 0
        canvasW = sizes["canvasW"] or 0
        assert abs(wrapW - canvasW) < 4, (
            f"wrap ({wrapW}) should match canvas ({canvasW}); "
            f"diff is the 96/72 double-count bug"
        )

        # (3) The canvas actually fills most of the reader pane (not 612px
        #     in a ~940px pane). Allow some slack for the 32px padding.
        reader_w = page.evaluate("() => document.querySelector('.reader')?.getBoundingClientRect().width")
        assert canvasW > (reader_w or 0) * 0.8, (
            f"canvas ({canvasW}) should fill ~80% of reader ({reader_w}) "
            f"with fit-width default"
        )

        # (4) Resize the viewport — fit-width must recompute (the
        #     ResizeObserver fix).
        page.set_viewport_size({"width": 900, "height": 900})
        time.sleep(1.5)
        new_canvas = page.evaluate(
            "() => document.querySelector('canvas.pdf-page-canvas')?.getBoundingClientRect().width"
        )
        new_reader = page.evaluate("() => document.querySelector('.reader')?.getBoundingClientRect().width")
        assert new_canvas is not None and new_canvas > 0
        # The canvas should track the reader's new width (with some
        # padding slack). At a smaller viewport the canvas shrinks.
        assert new_canvas < canvasW, (
            f"canvas should shrink when viewport shrinks "
            f"(was {canvasW}, now {new_canvas})"
        )
        assert new_canvas > (new_reader or 0) * 0.6, (
            f"canvas ({new_canvas}) should still fill most of "
            f"the smaller reader ({new_reader})"
        )
