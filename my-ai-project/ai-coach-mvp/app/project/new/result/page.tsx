"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getTemplateFromIDB, saveTemplateToIDB } from "@/lib/templateStore";
import styles from "./result.module.css";

type TemplateType = "레포트" | "실험보고서" | "논문" | "강의노트" | "문헌고찰";
type ChatMsg = { role: "ai" | "user"; text: string };

const TYPE_TO_DEFAULT_DOCX: Record<TemplateType, string> = {
  레포트: "report",
  실험보고서: "lab_report",
  논문: "thesis",
  강의노트: "lecture_note",
  문헌고찰: "review",
};

const IFRAME_SRC_DOC = [
  "<!DOCTYPE html>",
  "<html>",
  "<head>",
  '  <meta charset="utf-8"/>',
  "  <style>",
  "    body { margin:0; background:#eef2f6; }",
  "    #page { width: 850px; min-height: 1100px; margin: 24px auto; background: white; box-shadow: 0 10px 30px rgba(0,0,0,0.12); border-radius: 8px; overflow: hidden; }",
  "    #editor { padding: 80px 90px; font-family: 'Malgun Gothic', sans-serif; line-height: 1.8; font-size: 15px; color:#111; outline: none; min-height: 1100px; }",
  "  </style>",
  "</head>",
  "<body>",
  '  <div id="page">',
  '    <div id="editor" contenteditable="true" spellcheck="false">양식을 불러오는 중...</div>',
  "  </div>",
  "",
  "  <script>",
  "    const editor = document.getElementById('editor');",
  "    window.parent.postMessage({ __editor:true, type:'FRAME_READY' }, '*');",
  "",
  "    let t = null;",
  "    editor.addEventListener('input', () => {",
  "      clearTimeout(t);",
  "      t = setTimeout(() => {",
  "        window.parent.postMessage({ __editor:true, type:'EDIT_HTML', html: editor.innerHTML }, '*');",
  "      }, 250);",
  "    });",
  "",
  "    window.addEventListener('message', (ev) => {",
  "      const d = ev.data;",
  "      if (!d || !d.__editor) return;",
  "      if (d.type === 'SET_HTML') editor.innerHTML = d.html || \"\";",
  "    });",
  "  </script>",
  "</body>",
  "</html>",
].join("\n");

export default function ResultPage() {
  return (
    <Suspense fallback={<div style={{ padding: 20 }}>로딩 중...</div>}>
      <Workspace />
    </Suspense>
  );
}

function Workspace() {
  const router = useRouter();
  const sp = useSearchParams();

  const type = (sp.get("type") || "레포트") as TemplateType;
  const templateIdFromUrl = sp.get("templateId") || "";

  const [activeTemplateId, setActiveTemplateId] = useState(templateIdFromUrl);
  useEffect(() => setActiveTemplateId(templateIdFromUrl), [templateIdFromUrl]);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [frameReady, setFrameReady] = useState(false);
  const [docHTML, setDocHTML] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: "ai", text: "DOCX 템플릿 로딩 후, PDF 업로드로 자동 채움이 가능합니다." },
  ]);
  const [isLoading, setIsLoading] = useState(false);

  const loadedKeyRef = useRef<string>("");

  const sendHtmlToIframe = useCallback((html: string) => {
    const w = iframeRef.current?.contentWindow;
    if (!w) return;
    w.postMessage({ __editor: true, type: "SET_HTML", html }, "*");
  }, []);

  const normalizeTemplateHTML = (html: string) => {
    let s = (html || "")
      .replace(/&lcub;/g, "{")
      .replace(/&rcub;/g, "}")
      .replace(/\u00a0/g, " ");
    s = s.replace(/\u0000/g, "");
    return s;
  };

  const loadDocxArrayBufferToHtml = useCallback(async (arrayBuffer: ArrayBuffer) => {
    // mammoth는 동적 import가 안전합니다.
    const mammoth = await import("mammoth");
    const result = await mammoth.convertToHtml({ arrayBuffer });
    return normalizeTemplateHTML(result.value || "").trim();
  }, []);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== iframeRef.current?.contentWindow) return;
      if (!ev.data?.__editor) return;

      if (ev.data.type === "FRAME_READY") setFrameReady(true);
      if (ev.data.type === "EDIT_HTML") setDocHTML(String(ev.data.html || ""));
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!frameReady) return;

    const key = `${type}::${activeTemplateId || "DEFAULT"}`;
    if (loadedKeyRef.current === key) return;
    loadedKeyRef.current = key;

    const run = async () => {
      setIsLoading(true);
      setLoadError(null);
      setLoadingMessage("템플릿 로딩 중...");

      try {
        let buf: ArrayBuffer;

        if (activeTemplateId) {
          const rec = await getTemplateFromIDB(activeTemplateId);
          if (!rec?.buffer) throw new Error("IDB에서 DOCX 템플릿을 찾지 못했습니다.");
          buf = rec.buffer;
        } else {
          const fileName = TYPE_TO_DEFAULT_DOCX[type] || "report";
          const res = await fetch(`/templates/${fileName}.docx`, { cache: "no-store" });
          if (!res.ok) throw new Error(`기본 템플릿 로드 실패: /templates/${fileName}.docx (HTTP ${res.status})`);
          buf = await res.arrayBuffer();
        }

        const html = await loadDocxArrayBufferToHtml(buf);
        if (!html) throw new Error("DOCX 변환 결과가 비어있습니다.");

        setDocHTML(html);
        sendHtmlToIframe(html);
        setLoadingMessage(null);

        setMessages((prev) => [
          ...prev,
          { role: "ai", text: `템플릿 적용 완료. (templateId=${activeTemplateId ? "있음" : "없음"})` },
        ]);
      } catch (e) {
        console.error(e);
        setLoadError("템플릿 적용 실패. DOCX 업로드를 다시 시도하거나 콘솔(F12) 에러를 확인하세요.");
        setLoadingMessage(null);
        if (!docHTML) {
          const errHtml = `<div style="color:#b91c1c;font-weight:900;">템플릿 적용 실패</div>
            <div style="margin-top:8px;line-height:1.7;color:#334155;">
              - DOCX 업로드를 다시 시도하거나<br/>
              - 콘솔(F12) 에러를 확인하세요.
            </div>`;
          setDocHTML(errHtml);
          sendHtmlToIframe(errHtml);
        }
        setMessages((prev) => [...prev, { role: "ai", text: "템플릿 적용 실패. 콘솔(F12) 확인." }]);
      } finally {
        setIsLoading(false);
      }
    };

    run();
  }, [frameReady, type, activeTemplateId, loadDocxArrayBufferToHtml, sendHtmlToIframe]);

  const onUploadDocxTemplateHere = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsLoading(true);
      setLoadError(null);
      setLoadingMessage("DOCX 템플릿 적용 중...");
      setMessages((prev) => [...prev, { role: "ai", text: "DOCX 업로드 템플릿 적용 중..." }]);

      try {
        const buf = await file.arrayBuffer();
        const html = await loadDocxArrayBufferToHtml(buf);
        if (!html) throw new Error("DOCX 변환 결과가 비어있습니다.");

        sendHtmlToIframe(html);
        setDocHTML(html);

        const newId = await saveTemplateToIDB(file.name, buf);
        setActiveTemplateId(newId);
        loadedKeyRef.current = `${type}::${newId}`;
        router.replace(
          `/project/new/result?type=${encodeURIComponent(type)}&templateId=${encodeURIComponent(newId)}`
        );
      } catch (err) {
        console.error(err);
        setLoadError("DOCX 업로드/저장 실패. 콘솔(F12) 확인.");
        setMessages((prev) => [...prev, { role: "ai", text: "DOCX 업로드/저장 실패. 콘솔(F12) 확인." }]);
      } finally {
        e.currentTarget.value = "";
        setIsLoading(false);
        setLoadingMessage(null);
      }
    },
    [loadDocxArrayBufferToHtml, router, sendHtmlToIframe, type]
  );

  // PDF 업로드는 네 기존 자동채움 로직을 여기 붙이면 됩니다.
  const onUploadPdf = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setMessages((prev) => [...prev, { role: "ai", text: `PDF 업로드됨: ${file.name}` }]);
    e.currentTarget.value = "";
  }, []);

  const iframeSrcDoc = useMemo(() => IFRAME_SRC_DOC, []);

  return (

    <div className="flex h-screen w-screen overflow-hidden bg-gray-100">
      <aside className="flex w-[380px] flex-col border-r border-gray-300 bg-white">
        <div className="bg-blue-900 px-5 py-4 font-black text-white">
          WORKSPACE
          <div className="mt-1 text-xs opacity-90">

    <div className={styles.page}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          WORKSPACE
          <div className={styles.sidebarHeaderMeta}>

            type: {type} / templateId: {activeTemplateId ? "있음" : "없음"}
          </div>
        </div>


        <div className="border-b border-gray-200 p-4">
          <div className="flex flex-wrap gap-2.5">
            <label className="cursor-pointer rounded-lg border border-dashed border-blue-900 bg-white px-3 py-2.5 font-black text-blue-900">
        <div className={styles.uploadSection}>
          <div className={styles.uploadButtons}>
            <label className={styles.docxUpload}>

              DOCX 템플릿 업로드
              <input type="file" accept=".docx" hidden onChange={onUploadDocxTemplateHere} />
            </label>


            <label className="cursor-pointer rounded-lg border border-slate-300 bg-slate-900 px-3 py-2.5 font-black text-white">

            <label className={styles.pdfUpload}>

              PDF 업로드
              <input type="file" accept=".pdf" hidden onChange={onUploadPdf} />
            </label>
          </div>

          {isLoading && (

            <div className="mt-2.5 font-extrabold text-rose-600">

            <div className={styles.loadingNote}>

              {loadingMessage || "처리 중..."}
            </div>
          )}
        </div>


        <div className="flex-1 overflow-y-auto p-4 text-xs">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`mb-2.5 rounded-lg border border-slate-200 p-3 leading-6 ${
                m.role === "user" ? "bg-blue-50" : "bg-slate-50"

        <div className={styles.messageList}>
          {messages.map((m, i) => (
            <div
              key={i}
              className={`${styles.messageItem} ${
                m.role === "user" ? styles.messageUser : styles.messageAi

              }`}
            >
              {m.text}
            </div>
          ))}
        </div>
      </aside>


      <main className="relative flex-1 p-4">
        <iframe ref={iframeRef} srcDoc={iframeSrcDoc} className="h-full w-full border-0" />
        {(isLoading || loadError) && (
          <div className="pointer-events-none absolute inset-4 flex items-center justify-center rounded-xl bg-slate-900/35 p-6 text-center font-extrabold text-white">


      <main className={styles.main}>
        <iframe ref={iframeRef} srcDoc={iframeSrcDoc} className={styles.editorFrame} />
      <main style={{ flex: 1, padding: 18, position: "relative" }}>
        <iframe ref={iframeRef} srcDoc={iframeSrcDoc} style={{ width: "100%", height: "100%", border: "none" }} />

        {(isLoading || loadError) && (
          <div className={styles.overlay}>

            {loadError || loadingMessage || "처리 중..."}
          </div>
        )}
      </main>
    </div>
  );
}
