import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Viewer, type ViewerHandle } from "@plannotator/ui/components/Viewer";
import { AnnotationPanel } from "@plannotator/ui/components/AnnotationPanel";
import { ThemeProvider } from "@plannotator/ui/components/ThemeProvider";
import { configurePlannotatorUI } from "@plannotator/ui/configure";
import { parseMarkdownToBlocks } from "@plannotator/ui/utils/parser";
import { AnnotationType, type Annotation, type EditorMode, type InputMethod } from "@plannotator/ui/types";
import type { PlanDocument, ReviewResult } from "../src/browser-contract.ts";
import "@plannotator/ui/styles.css";
import "./style.css";

configurePlannotatorUI({ identityProvider: { getIdentity: () => "You", isCurrentUser: (author) => author === "You", isEditable: () => false },
  skillCatalogTransport: async () => [], docPreviewFetcher: async () => null,
  serverSync: async () => {}, webmcp: { enabled: false } });
async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Request failed");
  return result as T;
}
function App() {
  const match = /^\/plans\/([A-Za-z0-9-]+)\/([a-f0-9]{24})$/.exec(location.pathname);
  return match ? <Document endpoint={`/api/plans/${match[1]}/${match[2]}`} /> : <p role="alert">Invalid plan link</p>;
}
type Draft = { document: PlanDocument; annotations: Annotation[] };
function Document({ endpoint }: { endpoint: string }) {
  const [document, setDocument] = useState<PlanDocument>();
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>("comment");
  const [inputMethod, setInputMethod] = useState<InputMethod>("drag");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const viewer = useRef<ViewerHandle>(null);
  const storageKey = `pi-plan-review:${endpoint}`;
  const load = async () => {
    setError("");
    try {
      const current = await request<PlanDocument>(endpoint);
      let draft: Draft | undefined;
      try { draft = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Draft | undefined; } catch { /* Ignore malformed drafts. */ }
      if (draft && Array.isArray(draft.annotations) && draft.annotations.length && draft.document?.sessionId === current.sessionId && draft.document.id === current.id) {
        setDocument(draft.document); setAnnotations(draft.annotations);
      } else { setDocument(current); setAnnotations([]); }
    } catch (err) { setError((err as Error).message); }
  };
  useEffect(() => { void load(); }, [endpoint]);
  useEffect(() => {
    if (!document) return;
    try {
      if (annotations.length) localStorage.setItem(storageKey, JSON.stringify({ document, annotations }));
      else localStorage.removeItem(storageKey);
    } catch { setError("Browser storage is full. Keep this tab open until you submit or copy your comments."); }
  }, [document, annotations]);
  const blocks = useMemo(() => parseMarkdownToBlocks(document?.markdown ?? ""), [document?.markdown]);
  const send = async () => {
    if (!document || !annotations.length || busy) return;
    setBusy(true); setError(""); setNotice("");
    const comments = annotations.map((annotation) => ({ id: annotation.id, quote: annotation.originalText, text: annotation.text ?? (annotation.type === AnnotationType.DELETION ? "Remove this text" : "") }));
    try {
      const result = await request<ReviewResult>(`${endpoint}/reviews`, { comments });
      setAnnotations([]); viewer.current?.clearAllHighlights(); setNotice(result.message);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  if (!document) return <main className="connection"><p role={error ? "alert" : "status"}>{error || "Opening plan…"}</p></main>;
  return <div className="document-shell">
    {(notice || error) && <div className="notice" role={error ? "alert" : "status"}><p>{error || notice}</p></div>}
    <div className="review-layout"><main className="document-body">
      <Viewer ref={viewer} blocks={blocks} markdown={document.markdown} annotations={annotations} onAddAnnotation={(annotation) => setAnnotations((current) => [...current, annotation])} onSelectAnnotation={setSelected} selectedAnnotationId={selected} mode={mode} inputMethod={inputMethod} annotationHeader={{ onModeChange: setMode, onInputMethodChange: setInputMethod, hideQuickLabel: true }} actionsLabelMode="icon" taterMode={false} allowImages={false} quickLabels={false} disableCodePathValidation stickyActions={false} maxWidth={840} />
    </main><aside className="review-comments" aria-label="Review comments"><div className="comments-heading"><h2>Comments</h2><button onClick={() => void send()} disabled={!annotations.length || busy}>{busy ? "Submitting…" : `Submit${annotations.length ? ` (${annotations.length})` : ""}`}</button></div><AnnotationPanel presentation="embedded" isOpen annotations={annotations} blocks={blocks} selectedId={selected} onSelect={setSelected} onDelete={(id) => { viewer.current?.removeHighlight(id); setAnnotations((current) => current.filter((annotation) => annotation.id !== id)); }} onEdit={(id, updates) => setAnnotations((current) => current.map((annotation) => annotation.id === id ? { ...annotation, ...updates } : annotation))} sharingEnabled={false} /></aside></div>
  </div>;
}
createRoot(window.document.getElementById("root")!).render(<ThemeProvider defaultTheme="system"><App /></ThemeProvider>);
