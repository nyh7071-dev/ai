"use client";

import React, { useEffect, useRef, useState } from "react";

interface CollaboraEditorProps {
  fileId: string;
  fileName: string;
  onReady?: () => void;
}

export default function CollaboraEditor({
  fileId,
  fileName,
  onReady,
}: CollaboraEditorProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fileId || isLoaded) return;

    // WOPI URL 생성 - Docker 컨테이너에서 호스트에 접근하기 위해 host.docker.internal 사용
    const wopiSrc = `http://host.docker.internal:3000/api/collabora/wopi/files/${fileId}`;

    // Collabora를 /browser 경로를 통해 접근 (next.config.js rewrites 사용)
    const collaboraUrl = `${window.location.origin}/browser`;

    // iframe에 Collabora 편집기 로드
    const iframeUrl = `${collaboraUrl}/dist/cool.html?WOPISrc=${encodeURIComponent(wopiSrc)}&title=${encodeURIComponent(fileName)}`;

    console.log("Collabora URL:", iframeUrl);
    console.log("WOPI Src:", wopiSrc);

    if (iframeRef.current && !iframeRef.current.src) {
      iframeRef.current.src = iframeUrl;
    }

    // 로드 완료 이벤트 (한 번만 실행)
    const handleLoad = () => {
      if (!isLoaded) {
        console.log("Collabora iframe loaded");
        setIsLoaded(true);
        if (onReady) onReady();
      }
    };

    // 에러 핸들링
    const handleError = (e: ErrorEvent) => {
      console.error("Collabora iframe error:", e);
      setError("Collabora 서버에 연결할 수 없습니다. Docker 컨테이너가 실행 중인지 확인하세요.");
    };

    const iframe = iframeRef.current;
    if (iframe) {
      iframe.addEventListener("load", handleLoad);
      window.addEventListener("error", handleError);
      return () => {
        iframe.removeEventListener("load", handleLoad);
        window.removeEventListener("error", handleError);
      };
    }
  }, [fileId, fileName]);

  if (error) {
    return (
      <div style={{
        padding: "40px",
        textAlign: "center",
        color: "#ef4444",
        background: "#fee",
        borderRadius: "8px",
        margin: "20px"
      }}>
        <div style={{ fontSize: "18px", fontWeight: "bold", marginBottom: "10px" }}>
          Collabora 연결 실패
        </div>
        <div>{error}</div>
        <div style={{ marginTop: "20px", fontSize: "14px", color: "#666" }}>
          터미널에서 확인: docker ps | grep collabora
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", minHeight: "600px", position: "relative" }}>
      {!isLoaded && (
        <div style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          textAlign: "center",
          zIndex: 10
        }}>
          <div style={{ fontSize: "16px", color: "#666" }}>
            Collabora 편집기 로딩 중...
          </div>
          <div style={{ marginTop: "10px", fontSize: "12px", color: "#999" }}>
            처음 로드 시 시간이 걸릴 수 있습니다
          </div>
        </div>
      )}
      <iframe
        ref={iframeRef}
        style={{
          width: "100%",
          height: "100%",
          minHeight: "600px",
          border: "none",
          opacity: isLoaded ? 1 : 0.3,
        }}
        allow="clipboard-read; clipboard-write"
        title="Collabora Editor"
      />
    </div>
  );
}
