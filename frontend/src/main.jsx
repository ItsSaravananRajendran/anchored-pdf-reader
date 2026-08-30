/**
 * React entry point. Mounts <App /> into #root.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

// Register the PDF-cache service worker. Failure is non-fatal — the
// app still works without it, just with network round-trips on reopen.
if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => {
        navigator.serviceWorker
            .register("/sw.js", { scope: "/" })
            .catch((err) => {
                console.warn("[sw] registration failed:", err);
            });
    });
}

const container = document.getElementById("root");
if (!container) {
    throw new Error("#root not found in DOM — was index.html updated?");
}

createRoot(container).render(
    <StrictMode>
        <App />
    </StrictMode>
);