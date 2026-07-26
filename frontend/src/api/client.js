/**
 * HTTP client wrappers. No DOM access — just fetch + JSON.
 * Each function maps to one backend route. Errors throw Error with status + body.
 */

async function request(method, path, body) {
    const response = await fetch(path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
        let detail;
        try {
            detail = await response.text();
        } catch {
            detail = response.statusText;
        }
        const error = new Error(`${method} ${path} ${response.status}: ${detail}`);
        error.status = response.status;
        throw error;
    }
    if (response.status === 204) return null;
    return response.json();
}

// ---- PDFs ----

export const loadPdf = (url) => request("POST", "/api/pdf/load", { url });

export const listPdfs = () => request("GET", "/api/pdfs");

export const getPdfInfo = (hash) => request("GET", `/api/pdf/${hash}/info`);

export const getPdfAnchors = (hash) => request("GET", `/api/pdf/${hash}/anchors`);

export const getPdfText = (hash, pages) =>
    request("POST", `/api/pdf/${hash}/text`, { pages });

export const renderRectCrop = (hash, page, rect, scale = 2.0) =>
    request("POST", `/api/pdf/${hash}/rect.png`, { page, rect, scale });

// ---- Sessions ----

export const newSession = (pdfHash) =>
    request("POST", "/api/session/new", { pdf_hash: pdfHash });

export const getSessionMessages = (sessionId) =>
    request("GET", `/api/session/${sessionId}/messages`);

export const deleteSession = (sessionId) =>
    request("DELETE", `/api/session/${sessionId}`);

// ---- Anchors ----

export const deleteAnchor = (messageId) =>
    request("DELETE", `/api/anchor/${messageId}`);

// ---- File URL helpers (used by <img>, <canvas>, PDF.js) ----
// Helper URLs (used by the PDF.js loader and the rect-crop compositing)
export const fileUrl = (hash) => `/api/pdf/${hash}/file`;
export const rectUrl = (hash) => `/api/pdf/${hash}/rect.png`;