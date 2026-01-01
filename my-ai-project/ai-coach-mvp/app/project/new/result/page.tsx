"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useSearchParams } from "next/navigation";
import * as mammoth from "mammoth/mammoth.browser";

type TemplateType = "레포트" | "실험보고서" | "논문" | "강의노트" | "문헌고찰";
type ChatMsg = { role: "ai" | "user"; text: string };

const TYPE_TO_DEFAULT_DOCX: Record<TemplateType, string> = {
  레포트: "report",
  실험보고서: "lab_report",
  논문: "thesis",
  강의노트: "lecture_note",
  문헌고찰: "review",
};

function coerceTemplateType(v: string | null): TemplateType {
  if (v === "레포트" || v === "실험보고서" || v === "논문" || v === "강의노트" || v === "문헌고찰") return v;
  return "레포트";
}

const IFRAME_SRC_DOC = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { margin:0; background:#f8fafc; padding: 40px; font-family: 'Malgun Gothic', sans-serif; display: flex; justify-content: center; }
    #editor {
      background: white;
      width: 800px;
      min-height: 1100px;
      padding: 80px 90px;
      outline: none;
      box-shadow: 0 10px 40px rgba(0,0,0,0.05);
      border-radius: 6px;
      line-height: 1.8;
      color: #1e293b;
    }
    .muted { color:#64748b; font-size:14px; }
  </style>
</head>
<body>
  <div id="editor" contenteditable="true" spellcheck="false" class="muted">문서를 불러오는 중...</div>
  <script>
    const editor = document.getElementById('editor');
    window.parent.postMessage({ type: 'FRAME_READY' }, '*');

    window.addEventListener('message', (ev) => {
      if (!ev || !ev.data) return;
      if (ev.data.type === 'SET_HTML') editor.innerHTML = String(ev.data.html || "");
    });

    editor.addEventListener('input', () => {
      window.parent.postMessage({ type: 'EDIT_HTML', html: editor.innerHTML }, '*');
    });
  </script>
</body>
</html>`;

export default function ResultPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-gray-500">워크스페이스 준비 중...</div>}>
      <Workspace />
    </Suspense>
  );
}

function Workspace() {
  const searchParams = useSearchParams();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [frameReady, setFrameReady] = useState(false);
  const [docHTML, setDocHTML] = useState<string>("");

  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: "ai", text: "템플릿을 불러오는 중입니다. (좌측에서 DOCX 업로드 가능)" },
  ]);

  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);

  const type = coerceTemplateType(searchParams.get("type"));
  const iframeSrcDoc = useMemo(() => IFRAME_SRC_DOC, []);

  const normalizeTemplateHTML = useCallback((html: string) => {
    return (html || "")
      .replace(/&lcub;/g, "{")
      .replace(/&rcub;/g, "}")
      .replace(/\u00a0/g, " ")
      .replace(/\u0000/g, "");
  }, []);

  const sendHtmlToIframe = useCallback((html: string) => {
    const w = iframeRef.current?.contentWindow;
    if (!w) return;
    w.postMessage({ type: "SET_HTML", html }, "*");
  }, []);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (!ev?.data) return;
      if (ev.data.type === "FRAME_READY") setFrameReady(true);
      if (ev.data.type === "EDIT_HTML") setDocHTML(String(ev.data.html || ""));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!frameReady) return;

    const run = async () => {
      setIsLoading(true);
      setLoadError(null);
      setLoadingMessage("템플릿 로딩 중...");

      try {
        const fileName = TYPE_TO_DEFAULT_DOCX[type] || "report";
        const res = await fetch(`/templates/${fileName}.docx`, { cache: "no-store" });
        if (!res.ok) throw new Error(`기본 템플릿 로드 실패: /templates/${fileName}.docx (HTTP ${res.status})`);

        const buf = await res.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer: buf });
        const initial = normalizeTemplateHTML(result.value);

        setDocHTML(initial);
        sendHtmlToIframe(initial);

        setMessages((prev) => [...prev, { role: "ai", text: `기본 템플릿 적용 완료: ${type}` }]);
        setLoadingMessage(null);
      } catch (e: any) {
        const msg = e?.message || "템플릿 적용 실패";
        setLoadError(msg);
        setLoadingMessage(null);
        setMessages((prev) => [...prev, { role: "ai", text: `템플릿 적용 실패: ${msg}` }]);

        const errHtml = `<div style="color:#b91c1c;font-weight:900;">템플릿 적용 실패</div>
          <div style="margin-top:8px;line-height:1.7;color:#334155;">- ${String(msg).replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>`;
        setDocHTML(errHtml);
        sendHtmlToIframe(errHtml);
      } finally {
        setIsLoading(false);
      }
    };

    run();
  }, [frameReady, normalizeTemplateHTML, sendHtmlToIframe, type]);

  const onUploadDocx = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsLoading(true);
      setLoadError(null);
      setLoadingMessage("DOCX 업로드 적용 중...");

      try {
        const buf = await file.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer: buf });
        const html = normalizeTemplateHTML(result.value);

        setDocHTML(html);
        sendHtmlToIframe(html);

        setMessages((prev) => [
          ...prev,
          { role: "user", text: `DOCX 업로드: ${file.name}` },
          { role: "ai", text: "업로드 템플릿 적용 완료" },
        ]);
      } catch (err: any) {
        const msg = err?.message || "DOCX 업로드 실패";
        setLoadError(msg);
        setMessages((prev) => [...prev, { role: "ai", text: `DOCX 업로드 실패: ${msg}` }]);
      } finally {
        setLoadingMessage(null);
        setIsLoading(false);
        e.target.value = "";
      }
    },
    [normalizeTemplateHTML, sendHtmlToIframe]
  );

  return (
    <div className="flex w-screen h-screen bg-[#f3f4f6] overflow-hidden">
      <aside className="w-[380px] bg-white border-r border-gray-200 flex flex-col shadow-xl z-10">
        <div className="p-6 bg-[#1e40af] text-white font-black text-lg tracking-tight">WORKSPACE</div>

        <div className="p-4 border-b border-gray-100">
          <div className="text-sm font-extrabold text-slate-700 mb-3">현재 템플릿: {type}</div>

          <label className="px-3 py-2 rounded-xl border border-dashed border-blue-700 text-blue-800 font-extrabold cursor-pointer inline-block">
            DOCX 템플릿 업로드
            <input type="file" accept=".docx" hidden onChange={onUploadDocx} />
          </label>

          {(isLoading || loadError) && (
            <div className="mt-3 text-sm font-extrabold">
              {loadError ? <span className="text-red-600">{loadError}</span> : <span className="text-pink-600">{loadingMessage || "처리 중..."}</span>}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`p-3 rounded-xl border leading-relaxed ${
                m.role === "user"
                  ? "bg-blue-50 border-blue-100 text-slate-800"
                  : "bg-slate-50 border-slate-200 text-slate-700"
              }`}
            >
              {m.text}
            </div>
          ))}
        </div>
      </aside>

      <main className="flex-1 p-6 relative">
        <iframe ref={iframeRef} srcDoc={iframeSrcDoc} className="w-full h-full border-none rounded-2xl shadow-2xl bg-white" />
        {(isLoading || loadError) && (
          <div className="absolute inset-6 bg-slate-900/35 flex items-center justify-center p-6 rounded-2xl text-white font-extrabold text-center pointer-events-none">
            {loadError || loadingMessage || "처리 중..."}
          </div>
        )}
      </main>
    </div>
  );
}
