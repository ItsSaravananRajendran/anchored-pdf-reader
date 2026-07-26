"""Regression: navigation to a page beyond the initial viewport renders
the new page (not a blank default-sized canvas).

Bug: useVirtualPages.pagesInViewport fell through to scroll-based math
(scrollTop=0, clientHeight=820 -> visible range -2000..2820 -> pages
1..3 at the new fit-width scale of 1.54). scheduleRender bailed on
`!pagesInViewportSet().has(pageNum)`, so jumping to p.5+ via the
page-jump input left the canvas at default 300x150. Same bug for
anchor clicks on pages >3.

Fix: in paging mode, the scroll container has class `reader-single-page`
and overflow:hidden (no scrolling). The hook now detects that class
and falls back to "all currently mounted pages are in viewport" —
which is the right semantic for a one-page-at-a-time reader.
"""
import time

import pytest
from playwright.sync_api import sync_playwright

PDF_URL = "https://mml-book.github.io/book/mml-book.pdf"


@pytest.mark.browser
def test_navigation_to_page_beyond_initial_viewport_renders() -> None:
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
            timeout=180000,
        )
        time.sleep(3.0)

        def canvas_state() -> dict:
            return page.evaluate("""() => {
                const c = document.querySelector('canvas.pdf-page-canvas');
                const w = document.querySelector('[data-page]');
                let nw = 0;
                try {
                    const ctx = c.getContext('2d');
                    const img = ctx.getImageData(0,0,Math.min(c.width,400),Math.min(c.height,400));
                    for (let i=0;i<img.data.length;i+=400) {
                        if (img.data[i+3]>0 && (img.data[i]<250 || img.data[i+1]<250 || img.data[i+2]<250)) nw++;
                    }
                } catch {}
                return {
                    dataPage: w?.getAttribute('data-page'),
                    canvasW: c?.getBoundingClientRect().width,
                    canvasH: c?.getBoundingClientRect().height,
                    bufW: c?.width,
                    bufH: c?.height,
                    nonWhite: nw,
                };
            }""")

        # Jump from p.1 to p.10 — p.10 is far beyond the initial visible range
        page.fill(".page-jump", "10")
        page.press(".page-jump", "Enter")
        page.wait_for_function(
            "() => document.querySelector('.page-indicator')?.textContent.replace(/\\s+/g, '').startsWith('10')",
            timeout=5000,
        )
        time.sleep(2.0)
        s = canvas_state()
        assert s["dataPage"] == "10", f"data-page should be 10, got {s['dataPage']}"
        # Canvas must NOT be at the default 300x150 (the bug symptom)
        assert s["bufW"] is not None and s["bufW"] > 300, (
            f"canvas backing store not rendered for p.10 (bufW={s['bufW']}, "
            f"bufH={s['bufH']}) — the pagesInViewport bug strikes again"
        )
        assert s["canvasW"] > 300, f"CSS canvas width still default: {s['canvasW']}"
        # Should have actual content (text on a page)
        assert s["nonWhite"] > 5, f"page 10 has no rendered content (nonWhite={s['nonWhite']})"

        # Also: click an anchor on p.27 (beyond the initial 1..3 viewport)
        clicked = page.evaluate("""() => {
            const rows = document.querySelectorAll('.anchor-row');
            for (const r of rows) {
                const b = r.querySelector('.page-badge');
                if (b && b.textContent.includes('p.27')) { r.click(); return true; }
            }
            return false;
        }""")
        assert clicked, "no anchor chip for p.27"
        page.wait_for_function(
            "() => document.querySelector('.page-indicator')?.textContent.replace(/\\s+/g, '').startsWith('27')",
            timeout=5000,
        )
        time.sleep(2.0)
        s2 = canvas_state()
        assert s2["dataPage"] == "27"
        assert s2["bufW"] is not None and s2["bufW"] > 300, (
            f"anchor click on p.27 left canvas blank (bufW={s2['bufW']})"
        )
        assert s2["nonWhite"] > 0, f"page 27 has no rendered content (nonWhite={s2['nonWhite']})"
