/**
 * useLoadPdf — orchestrates loading a PDF (from URL or by hash).
 *
 * Encapsulates: fetching PDF.js, opening the document, refreshing the
 * library + anchor list, creating a fresh session.
 */

import { useCallback, useState } from "react";
import * as api from "../api/client";
import { getPdfJs } from "../lib/pdfjs";
import { useApp } from "../state/AppContext";

export function useLoadPdf({ setMessages, setSessionLabel, onBeforeLoad }) {
    const { state, dispatch } = useApp();
    const [pdfDoc, setPdfDoc] = useState(null);

    const refreshLibrary = useCallback(async () => {
        try {
            const { items } = await api.listPdfs();
            dispatch({ type: "LIBRARY_SET", payload: { library: items } });
        } catch (e) {
            console.error("[useLoadPdf] refreshLibrary failed:", e);
        }
    }, [dispatch]);

    const refreshBookAnchors = useCallback(async (pdfHash) => {
        try {
            const { anchors } = await api.getPdfAnchors(pdfHash);
            dispatch({ type: "BOOK_ANCHORS_SET", payload: { bookAnchors: anchors } });
        } catch (e) {
            console.error("[useLoadPdf] refreshBookAnchors failed:", e);
        }
    }, [dispatch]);

    const openDocument = useCallback(async (pdfHash) => {
        const pdfjs = await getPdfJs();
        return await pdfjs.getDocument({ url: api.fileUrl(pdfHash) }).promise;
    }, []);

    const loadFromUrl = useCallback(async (url) => {
        if (onBeforeLoad) onBeforeLoad();
        dispatch({ type: "STATUS", payload: { status: "loading" } });
        try {
            const info = await api.loadPdf(url);
            dispatch({ type: "PDF_LOADED", payload: { pdfInfo: { ...info, url } } });
            const doc = await openDocument(info.pdf_hash);
            setPdfDoc(doc);
            await refreshBookAnchors(info.pdf_hash);
            await refreshLibrary();
            const { session_id } = await api.newSession(info.pdf_hash);
            dispatch({ type: "SESSION_CREATED", payload: { sessionId: session_id } });
            setSessionLabel("new session");
            setMessages([]);
        } catch (e) {
            console.error("[useLoadPdf] loadFromUrl failed:", e);
            dispatch({ type: "STATUS", payload: { status: "error", errorMessage: String(e) } });
        }
    }, [dispatch, openDocument, refreshBookAnchors, refreshLibrary, setMessages, setSessionLabel, onBeforeLoad]);

    const openByHash = useCallback(async (pdfHash) => {
        if (onBeforeLoad) onBeforeLoad();
        dispatch({ type: "STATUS", payload: { status: "loading" } });
        try {
            const info = await api.getPdfInfo(pdfHash);
            dispatch({ type: "PDF_LOADED", payload: { pdfInfo: info } });
            const doc = await openDocument(info.pdf_hash);
            setPdfDoc(doc);
            await refreshBookAnchors(info.pdf_hash);
            await refreshLibrary();
            const { session_id } = await api.newSession(info.pdf_hash);
            dispatch({ type: "SESSION_CREATED", payload: { sessionId: session_id } });
            setSessionLabel("new session");
            setMessages([]);
        } catch (e) {
            console.error("[useLoadPdf] openByHash failed:", e);
            dispatch({ type: "STATUS", payload: { status: "error", errorMessage: String(e) } });
        }
    }, [dispatch, openDocument, refreshBookAnchors, refreshLibrary, setMessages, setSessionLabel, onBeforeLoad]);

    return { pdfDoc, loadFromUrl, openByHash, refreshLibrary, refreshBookAnchors };
}