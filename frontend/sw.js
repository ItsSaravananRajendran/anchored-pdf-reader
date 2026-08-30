/**
 * Service Worker — cache PDF file responses so reopening a cached PDF
 * skips the network round-trip to the backend.
 *
 * Strategy:
 *   - Intercept GET /api/pdf/<hash>/file (the PDF blob endpoint).
 *   - On first fetch, network-first (so we never serve stale broken
 *     content if the backend was updated).
 *   - On subsequent opens of the same hash, cache-first (instant load).
 *   - Cache is LRU-bounded at MAX_ENTRIES by recency of access.
 *
 * Note: PDFs are content-addressed by SHA-256 hash, so cache invalidation
 * is automatic — a new PDF gets a new hash and never overlaps with a
 * cached one. No TTL needed.
 */

const CACHE_NAME = "pdf-reader-pdfs-v2";
const MAX_ENTRIES = 8; // ~most-recent 8 PDFs on disk
const PDF_URL_RE = /^\/api\/pdf\/[a-f0-9]+\/file$/;

self.addEventListener("install", (event) => {
    // Activate immediately so we don't make users wait for reload.
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    // Take control of all open clients and wipe any old-version caches.
    // Bumping CACHE_NAME on every release is the easiest way to invalidate
    // cached PDFs if the format ever changes; the new SW will start with
    // a clean cache.
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(
            keys
                .filter((k) => k.startsWith("pdf-reader-pdfs-") && k !== CACHE_NAME)
                .map((k) => caches.delete(k))
        );
        await self.clients.claim();
    })());
});

async function trimCache(cache) {
    const keys = await cache.keys();
    if (keys.length <= MAX_ENTRIES) return;
    // Delete the oldest entries first.
    const excess = keys.length - MAX_ENTRIES;
    for (let i = 0; i < excess; i += 1) {
        await cache.delete(keys[i]);
    }
}

self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
    if (!PDF_URL_RE.test(url.pathname)) return;

    event.respondWith(handlePdf(req));
});

async function handlePdf(req) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);

    if (cached) {
        // Cache-first. Refresh in the background so a corrupted cache entry
        // gets replaced silently next session.
        event_waitUntil_refresh(req, cache);
        // Touch the entry to mark it recently used (LRU).
        cache.put(req, cached.clone());
        return cached;
    }

    // Cache miss: fetch from network, cache the response, return it.
    try {
        const resp = await fetch(req);
        if (resp && resp.ok) {
            // pdfjs.getDocument needs a streamed ArrayBuffer response;
            // opaque streams are fine to cache as long as we don't
            // mutate the body.
            cache.put(req, resp.clone());
            trimCache(cache);
        }
        return resp;
    } catch (err) {
        // Network failed and no cache: surface the failure.
        throw err;
    }
}

// Refresh a cached entry in the background. Errors are swallowed —
// the user already has the cached response, so a transient backend
// hiccup shouldn't affect them.
function event_waitUntil_refresh(req, cache) {
    return fetch(req)
        .then((resp) => {
            if (resp && resp.ok) cache.put(req, resp.clone());
        })
        .catch(() => {});
}
