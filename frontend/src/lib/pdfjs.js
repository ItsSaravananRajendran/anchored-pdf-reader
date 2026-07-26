/**
 * PDF.js init. The library is loaded via CDN <script type="module"> in index.html
 * and exposes window.pdfjsLib globally. We resolve it lazily because the
 * module script may not have executed by the time our bundle runs.
 */

const PDFJS_VERSION = "4.7.76";
const WORKER_SRC = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;

let initialized = false;

export async function getPdfJs() {
    if (typeof window === "undefined") {
        throw new Error("pdfjs.js can only run in a browser context");
    }
    // The CDN script is type=module, so it loads asynchronously. Poll until ready.
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (window.pdfjsLib) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!window.pdfjsLib) {
        throw new Error("pdfjsLib not available on window — check the CDN script tag");
    }
    if (!initialized) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_SRC;
        initialized = true;
    }
    return window.pdfjsLib;
}