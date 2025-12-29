"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import * as mammoth from "mammoth/mammoth.browser";
import { getTemplateFromIDB, saveTemplateToIDB } from "@/lib/templateStore";

type TemplateType = "레포트" | "실험보고서" | "논문" | "강의노트" | "문헌고찰";
type ChatMsg = { role: "ai" | "user"; text: string };

const TYPE_TO_DEFAULT_DOCX: Record<TemplateType, string> = {
  레포트: "report",
  실험보고서: "lab_report",
  논문: "thesis",
  강의노트: "lecture_note",
  문헌고찰: "review",
};


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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: "ai", text: "DOCX 템플릿 로딩 후, PDF 업로드로 자동 채움이 가능합니다." },
  ]);

  const [isLoading, setIsLoading] = useState(false);

  const loadedKeyRef = useRef<string>("");


  const sendHtmlToIframe = useCallback((html: string) => {
    const w = iframeRef.current?.contentWindow;
    if (w) w.postMessage({ __editor: true, type: "SET_HTML", html }, "*");
  }, []);

  const normalizeTemplateHTML = (html: string) => {
    return (html || "")
      .replace(/&lcub;/g, "{")
      .replace(/&rcub;/g, "}")
      .replace(/\u00a0/g, " ")
      .replace(/\u0000/g, "");
  };

  // 2. 동적 템플릿 로드 로직
  useEffect(() => {
    const loadTemplate = async () => {
      // URL에서 ?type=... 값을 읽어옴 (없으면 기본값 '레포트')
      const typeParam = searchParams.get("type") || "레포트";

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

        // (이 아래는 원래 있던 mammoth 변환 → setDocHTML → sendHtmlToIframe → catch/finally → run() 흐름이 이어져야 합니다.)

        const arrayBuffer = await res.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        const initial = normalizeTemplateHTML(result.value);

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

    if (frameReady) loadTemplate();
  }, [frameReady, searchParams]); // 파라미터가 바뀌면 자동으로 다시 실행됨

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.data?.type === "FRAME_READY") setFrameReady(true);
      if (ev.data?.type === "EDIT_HTML") setDocHTML(ev.data.html);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className="flex w-screen h-screen bg-[#f3f4f6] overflow-hidden">
      {/* 좌측 사이드바 */}
      <aside className="w-[380px] bg-white border-r border-gray-200 flex flex-col shadow-xl z-10">
        <div className="p-6 bg-[#1e40af] text-white font-bold text-lg tracking-tight">AI WORD EDITOR</div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl">
            <p className="text-xs text-blue-600 font-bold uppercase tracking-widest mb-1">
              Current Template
            </p>
            <p className="text-lg font-black text-blue-900">{searchParams.get("type") || "레포트"}</p>
          </div>
          <div className="p-5 bg-gray-50 rounded-2xl text-sm text-gray-600 leading-relaxed border border-gray-100">
            선택하신 <span className="font-bold text-blue-600">[{searchParams.get("type") || "레포트"}]</span>{" "}
            양식을 불러왔습니다. <br />작성을 시작해볼까요?
          </div>
        </div>
      </aside>

      {/* 우측 에디터 메인 */}
      <main className="flex-1 p-6 relative flex flex-col">
        <iframe
          ref={iframeRef}
          srcDoc={EDITOR_HTML}
          className="w-full h-full border-none rounded-2xl shadow-2xl bg-white"
        />
      </main>
    </div>
  );
}

// 에디터 엔진 (Iframe 내부)
const EDITOR_HTML = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin:0; background:#f8fafc; padding: 40px; font-family: 'Malgun Gothic', sans-serif; display: flex; justify-content: center; }
    #editor { background: white; width: 800px; min-height: 1100px; padding: 80px 90px; outline: none; box-shadow: 0 10px 40px rgba(0,0,0,0.05); border-radius: 4px; line-height: 1.8; color: #1e293b; }
  </style>
</head>
<body>
  <div id="editor" contenteditable="true" spellcheck="false">문서를 불러오는 중...</div>
  <script>
    const editor = document.getElementById('editor');
    window.parent.postMessage({ type: 'FRAME_READY' }, '*');
    window.addEventListener('message', (ev) => {
      if (ev.data.type === 'SET_HTML') editor.innerHTML = ev.data.html;
    });
    editor.addEventListener('input', () => {
      window.parent.postMessage({ type: 'EDIT_HTML', html: editor.innerHTML }, '*');
    });
  </script>
</body>
</html>
    `;
  }, []);

  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh", background: "#f3f4f6" }}>
      <aside style={{ width: 380, background: "#fff", borderRight: "1px solid #ddd", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: 18, background: "#1e40af", color: "#fff", fontWeight: 900 }}>
          WORKSPACE
          <div style={{ fontSize: 12, opacity: 0.9, marginTop: 4 }}>
            type: {type} / templateId: {activeTemplateId ? "있음" : "없음"}
          </div>
        </div>

        <div style={{ padding: 14, borderBottom: "1px solid #eee" }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <label
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px dashed #1e40af",
                background: "#fff",
                color: "#1e40af",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              DOCX 템플릿 업로드
              <input type="file" accept=".docx" hidden onChange={onUploadDocxTemplateHere} />
            </label>

            <label
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #cbd5e1",
                background: "#0f172a",
                color: "#fff",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              PDF 업로드
              <input type="file" accept=".pdf" hidden onChange={onUploadPdf} />
            </label>
          </div>

          {isLoading && (
            <div style={{ marginTop: 10, color: "#e11d48", fontWeight: 800 }}>
              {loadingMessage || "처리 중..."}
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 14, fontSize: 13 }}>
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                marginBottom: 10,
                padding: 12,
                borderRadius: 10,
                background: m.role === "user" ? "#eff6ff" : "#f8fafc",
                border: "1px solid #e2e8f0",
                lineHeight: 1.6,
              }}
            >
              {m.text}
            </div>
          ))}
        </div>
      </aside>

      <main style={{ flex: 1, padding: 18, position: "relative" }}>
        <iframe ref={iframeRef} srcDoc={iframeSrcDoc} style={{ width: "100%", height: "100%", border: "none" }} />
        {(isLoading || loadError) && (
          <div
            style={{
              position: "absolute",
              inset: 18,
              background: "rgba(15, 23, 42, 0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              borderRadius: 12,
              color: "#fff",
              fontWeight: 800,
              textAlign: "center",
              pointerEvents: "none",
            }}
          >
            {loadError || loadingMessage || "처리 중..."}
          </div>
        )}
      </main>
    </div>
  );
}
