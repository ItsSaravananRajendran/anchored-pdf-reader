import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// Vite serves the React dev build with hot reload.
// In production, run `npm run build` to produce frontend/dist/app.js + index.html.
// The Python backend mounts `frontend/dist/` at `/static/dist/`, so the bundled
// file is served at /static/dist/app.js.
//
// We don't use index.html as the build entry because it references CDN scripts
// (PDF.js, marked, KaTeX) via <script type="module">, which Rollup tries to
// bundle and fails on. Instead we build main.jsx → app.js, then copy index.html
// to dist/. This is "Option A" from the v3 spec — the CDN scripts remain as
// remote imports in index.html and are not processed by Rollup at all.
export default defineConfig({
    plugins: [react()],
    root: "frontend",
    build: {
        outDir: "dist",
        sourcemap: true,
        target: "es2020",
        emptyOutDir: true,
        rollupOptions: {
            input: resolve(__dirname, "frontend/src/main.jsx"),
            output: {
                entryFileNames: "app.js",
                format: "es",
            },
        },
    },
    server: {
        port: 5173,
        // Proxy /api and /static to the FastAPI server during development.
        proxy: {
            "/api": "http://127.0.0.1:8910",
            "/static": "http://127.0.0.1:8910",
        },
    },
});