"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
      setMessages((prev) => [...prev, { role: "ai", text: "DOCX 업로드 템플릿 적용 중..." }]);

      try {
        const buf = await file.arrayBuffer();
        const newId = await saveTemplateToIDB(file.name, buf);

        setActiveTemplateId(newId);
        loadedKeyRef.current = ""; // 강제 리로드
        router.replace(
          `/project/new/result?type=${encodeURIComponent(type)}&templateId=${encodeURIComponent(newId)}`
        );
      } catch (err) {
        console.error(err);
        setMessages((prev) => [...prev, { role: "ai", text: "DOCX 업로드/저장 실패. 콘솔(F12) 확인." }]);
      } finally {
        e.currentTarget.value = "";
        setIsLoading(false);
      }
    },
    [router, type]
  );

  // PDF 업로드는 네 기존 자동채움 로직을 여기 붙이면 됩니다.
  const onUploadPdf = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setMessages((prev) => [...prev, { role: "ai", text: `PDF 업로드됨: ${file.name}` }]);
    e.currentTarget.value = "";
  }, []);

  const iframeSrcDoc = useMemo(
    () =>
      [
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
      ].join("\n"),
    []
  );

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
