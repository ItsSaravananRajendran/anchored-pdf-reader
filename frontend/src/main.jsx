/**
 * React entry point. Mounts <App /> into #root.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

const container = document.getElementById("root");
if (!container) {
    throw new Error("#root not found in DOM — was index.html updated?");
}

createRoot(container).render(
    <StrictMode>
        <App />
    </StrictMode>
);