"use client";

import { useState, Suspense, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import * as mammoth from "mammoth/mammoth.browser";

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
  const [docHTML, setDocHTML] = useState("");

  // 1. URL 파라미터(한글)와 실제 파일명(영어) 매칭 테이블
  const typeMap: Record<string, string> = {
    레포트: "report",
    실험보고서: "lab_report",
    논문: "thesis",
    강의노트: "lecture_note",
    문헌고찰: "review",
  };

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

      // 매핑 테이블에서 영어 파일명을 찾음
      const fileName = typeMap[typeParam] || "report";
      const filePath = `/templates/${fileName}.docx`;

      try {
        const res = await fetch(filePath, { cache: "no-store" });
        if (!res.ok) throw new Error(`${filePath} 파일을 찾을 수 없습니다.`);

        const arrayBuffer = await res.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        const initial = normalizeTemplateHTML(result.value);

        setDocHTML(initial);
        if (frameReady) sendHtmlToIframe(initial);
      } catch (e) {
        console.error("템플릿 로드 오류:", e);
        setDocHTML(
          `<div style="color:red; padding:20px;">오류: ${typeParam} 양식 파일을 찾을 수 없습니다. (경로: ${filePath})</div>`
        );
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
