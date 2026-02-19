"use client";

import { useEffect, useRef, useState } from "react";

interface OnlyOfficeEditorProps {
  fileId: string;
  fileName: string;
  onReady?: () => void;
}

export default function OnlyOfficeEditor({ fileId, fileName, onReady }: OnlyOfficeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const calledRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!calledRef.current) {
      calledRef.current = true;
      onReady?.();
    }
  }, [onReady]);

  useEffect(() => {
    if (!fileId || !containerRef.current) return;
    let cancelled = false;

    async function renderDocx() {
      try {
        setLoading(true);
        setError(null);

        // 1) DOCX 다운로드
        const res = await fetch(`/api/onlyoffice/file/${fileId}`);
        if (!res.ok) throw new Error(`파일 로드 실패 (${res.status})`);
        const arrayBuffer = await res.arrayBuffer();
        if (cancelled) return;

        // 2) docx-preview import
        const docxPreview = await import("docx-preview");

        const container = containerRef.current!;
        container.innerHTML = "";

        // 3) iframe으로 Tailwind CSS 완전 격리
        const iframe = document.createElement("iframe");
        iframe.style.cssText = "width:100%;height:100%;border:none;background:white;";
        container.appendChild(iframe);

        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!iframeDoc) throw new Error("iframe document 접근 불가");

        iframeDoc.open();
        iframeDoc.write(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>
  html, body { margin:0; padding:0; background:#e8e8e8; overflow-x:hidden; }
  #docx-root { padding: 10px 0; }
  section.docx { margin: 0 auto !important; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
</style>
</head>
<body><div id="docx-root"></div></body></html>`);
        iframeDoc.close();

        const root = iframeDoc.getElementById("docx-root");
        if (!root) throw new Error("iframe 렌더 타겟 없음");

        // 4) iframe 내부에 docx-preview 렌더링 (스타일도 iframe head로)
        await docxPreview.renderAsync(arrayBuffer, root, iframeDoc.head, {
          className: "docx",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          trimXmlDeclaration: true,
          ignoreLastRenderedPageBreak: true,
        });

      } catch (err: any) {
        if (!cancelled) {
          console.error("[OnlyOfficeEditor] 렌더링 실패:", err);
          setError(err.message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    renderDocx();
    return () => { cancelled = true; };
  }, [fileId]);

  return (
    <div style={{ width: "100%", height: "100%", overflow: "hidden", background: "#e8e8e8", position: "relative" }}>
      {loading && (
        <div style={{ padding: 40, textAlign: "center", color: "#666" }}>
          문서 렌더링 중...
        </div>
      )}
      {error && (
        <div style={{ padding: 20, textAlign: "center", color: "#dc3545" }}>
          미리보기 실패: {error}
        </div>
      )}
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
