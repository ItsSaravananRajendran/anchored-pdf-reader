/**
 * App — top-level layout + wiring.
 *
 * Orchestrates state, hooks, and components. This is the only place
 * where feature modules' handlers are tied together.
 */

import { useState, useRef, useEffect } from "react";
import { AppProvider, useApp, useStateSelector } from "./state/AppContext.jsx";

import { usePersistence } from "./hooks/usePersistence";
import { useVirtualPages } from "./hooks/useVirtualPages";
import { usePageJump } from "./hooks/usePageJump";
import { useSession } from "./hooks/useSession";
import { useLoadPdf } from "./hooks/useLoadPdf";
import { useSendMessage } from "./hooks/useSendMessage";
import { useFitWidthScale } from "./hooks/useFitWidthScale";
import { useResetDocumentState } from "./hooks/useResetDocumentState";
import { useAnchorActions } from "./hooks/useAnchorActions";

import Reader from "./components/Reader.jsx";
import ReaderToolbar from "./components/ReaderToolbar.jsx";
import ChatPanel from "./components/ChatPanel.jsx";
import PanelDivider from "./components/PanelDivider.jsx";
import StatusBar from "./components/StatusBar.jsx";
import EmptyState from "./components/EmptyState.jsx";
import LoadingState from "./components/LoadingState.jsx";
import ErrorState from "./components/ErrorState.jsx";

import "../styles/reset.css";
import "../styles/tokens.css";
import "../styles/app.css";

function Shell() {
    const { state, dispatch } = useApp();
    const pdfInfo = useStateSelector((s) => s.pdfInfo);
    const pendingAnchor = useStateSelector((s) => s.pendingAnchor);
    const sessionId = useStateSelector((s) => s.sessionId);
    const viewingOldSession = useStateSelector((s) => s.viewingOldSession);
    const bookAnchors = useStateSelector((s) => s.bookAnchors);
    const library = useStateSelector((s) => s.library);
    const status = useStateSelector((s) => s.status);
    const errorMessage = useStateSelector((s) => s.errorMessage);

    const [urlInput, setUrlInput] = useState("");
    const [zoomMode, setZoomMode] = useState("1.0");
    const [chatWidth, setChatWidth] = useState(420);
    const [currentPage, setCurrentPage] = useState(1);
    const [messages, setMessages] = useState([]);
    const [sessionLabel, setSessionLabel] = useState("");
    const [renderedPages, setRenderedPages] = useState(0);

    const scrollContainerRef = useRef(null);

    const clearDocumentState = useResetDocumentState({
        setCurrentPage, setMessages, setSessionLabel, setRenderedPages, scrollContainerRef,
    });

    usePersistence({ zoomMode, setZoomMode, chatWidth, setChatWidth });
    const loader = useLoadPdf({
        setMessages, setSessionLabel,
        onBeforeLoad: () => { dispatch({ type: "PDF_CLEAR" }); clearDocumentState(); },
    });
    const scale = useFitWidthScale({ zoomMode, pdfDoc: loader.pdfDoc, scrollContainerRef });
    const virtualPages = useVirtualPages({
        pdfDoc: loader.pdfDoc, scale, scrollContainerRef,
        pageCount: pdfInfo?.page_count || 0,
        onStatusChange: ({ rendered }) => setRenderedPages(rendered),
    });
    const pageJump = usePageJump({
        pageCount: pdfInfo?.page_count || 0, scrollContainerRef,
        currentPage, setCurrentPage, schedulePageRender: virtualPages.scheduleRender,
    });
    const session = useSession({ dispatch });
    const sendMessage = useSendMessage({
        pendingAnchor, sessionId, setMessages,
        onAfterSend: () => {
            const hash = state.pdfInfo?.pdf_hash;
            if (hash) { loader.refreshBookAnchors(hash); loader.refreshLibrary(); }
        },
    });
    const actions = useAnchorActions({
        pdfInfo, state, dispatch, setMessages, setSessionLabel, pageJump, loader, session,
    });

    useEffect(() => { loader.refreshLibrary(); }, [loader.refreshLibrary]);

    return (
        <div className="app-shell">
            <ReaderToolbar
                pdfInfo={pdfInfo} library={library} urlInput={urlInput} setUrlInput={setUrlInput}
                onLoad={() => loader.loadFromUrl(urlInput)}
                onPickFromLibrary={(hash) => loader.openByHash(hash)}
                zoomMode={zoomMode} setZoomMode={setZoomMode}
                currentPage={currentPage} onPageJump={pageJump.scrollToPage}
                onClearPending={() => dispatch({ type: "PENDING_ANCHOR_CLEAR" })}
                pendingAnchor={pendingAnchor}
            />
            <div className="app-main">
                {status === "loading" && <LoadingState />}
                {status === "error" && (
                    <ErrorState message={errorMessage || "Something went wrong."}
                        onRetry={() => urlInput && loader.loadFromUrl(urlInput)} />
                )}
                {status !== "loading" && status !== "error" && !pdfInfo && (
                    <EmptyState onLoadClick={() => document.getElementById("urlInput")?.focus()} />
                )}
                {pdfInfo && (
                    <div className="reader-chat-grid">
                        <Reader
                            pdfInfo={pdfInfo} pdfDoc={loader.pdfDoc} scale={scale}
                            scrollContainerRef={scrollContainerRef}
                            pages={virtualPages.pages} setPageEntry={virtualPages.setPageEntry}
                            scheduleRender={virtualPages.scheduleRender}
                            onCommitRect={actions.commitRect}
                            onClickAnchor={actions.loadSessionForAnchor}
                            historicalAnchors={bookAnchors}
                        />
                        <PanelDivider getChatWidth={() => chatWidth} setChatWidth={setChatWidth} persistPrefs={() => {}} />
                        <ChatPanel
                            anchors={bookAnchors} messages={messages} pendingAnchor={pendingAnchor}
                            onAnchorClick={actions.loadSessionForAnchor}
                            onAnchorDelete={actions.deleteAnchor}
                            onSend={sendMessage} onNewSession={actions.newSession}
                            viewingOldSession={viewingOldSession} sessionLabel={sessionLabel}
                        />
                    </div>
                )}
            </div>
            <StatusBar pdfInfo={pdfInfo} renderedPages={renderedPages}
                pageCount={pdfInfo?.page_count || 0} scale={scale} />
        </div>
    );
}

function App() {
    return (
        <AppProvider>
            <Shell />
        </AppProvider>
    );
}

export default App;