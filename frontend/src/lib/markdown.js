/**
 * Markdown + KaTeX rendering for assistant messages.
 *
 * This is the ONLY module that references `marked` or `katex` globals
 * (loaded via CDN in index.html). All other modules call into this one.
 *
 * Lazy: the CDN globals may not be ready when this module loads.
 */

import DOMPurify from "dompurify";
import { escapeHtml } from "./utils";

let initialized = false;

function _tryInit() {
    if (initialized) return true;
    if (typeof window === "undefined") return false;
    if (!window.marked || !window.katex) return false;

    const { marked, katex } = window;

    // Custom inline math: $...$
    marked.use({
        extensions: [
            {
                name: "inlineMath",
                level: "inline",
                start(src) { return src.indexOf("$"); },
                tokenizer(src) {
                    const match = /^\$([^$\n]+?)\$/.exec(src);
                    if (!match) return undefined;
                    return {
                        type: "inlineMath",
                        raw: match[0],
                        text: match[1],
                    };
                },
                renderer(token) {
                    try {
                        return katex.renderToString(token.text, {
                            throwOnError: false,
                            displayMode: false,
                        });
                    } catch (e) {
                        return escapeHtml(token.text);
                    }
                },
            },
            {
                name: "blockMath",
                level: "block",
                start(src) { return src.indexOf("$$"); },
                tokenizer(src) {
                    const match = /^\$\$([^$]+?)\$\$(?:\n|$)/.exec(src);
                    if (!match) return undefined;
                    return {
                        type: "blockMath",
                        raw: match[0],
                        text: match[1],
                    };
                },
                renderer(token) {
                    try {
                        return katex.renderToString(token.text, {
                            throwOnError: false,
                            displayMode: true,
                        });
                    } catch (e) {
                        return `<pre>${escapeHtml(token.text)}</pre>`;
                    }
                },
            },
        ],
    });

    initialized = true;
    return true;
}

/** Render markdown to HTML. Returns "" if marked/katex aren't loaded yet. */
export function renderMarkdown(text) {
    if (!_tryInit()) {
        return escapeHtml(text || "");
    }
    try {
        const rawHtml = window.marked.parse(text || "");
        // Sanitize: strip any HTML that came in through the assistant text.
        // KaTeX renders are trusted (they go through renderToString which
        // produces only structured HTML); DOMPurify's allowlist lets those
        // through and drops any raw <script>, on*=..., or javascript: URLs.
        return DOMPurify.sanitize(rawHtml, {
            ALLOWED_TAGS: [
                "p", "br", "strong", "em", "b", "i", "u", "s", "code", "pre",
                "a", "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4",
                "h5", "h6", "hr", "table", "thead", "tbody", "tr", "th", "td",
                "span", "div",
            ],
            ALLOWED_ATTR: ["href", "title", "class", "style", "target", "rel"],
        });
    } catch (e) {
        return escapeHtml(text || "");
    }
}

/** Try to initialize now (call from a useEffect on mount to be safe). */
export function ensureMarkdownReady() {
    return _tryInit();
}