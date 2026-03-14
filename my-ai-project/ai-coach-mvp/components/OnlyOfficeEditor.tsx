"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    DocsAPI?: {
      DocEditor: new (
        id: string,
        config: Record<string, unknown>
      ) => { destroyEditor?: () => void };
    };
  }
}

interface OnlyOfficeEditorProps {
  fileUrl: string;
  fileId: string;
  accessToken: string;
  fileName?: string;
  documentKey: string;
  mode?: "view" | "edit";
  style?: React.CSSProperties;
  className?: string;
}

const ONLYOFFICE_URL =
  process.env.NEXT_PUBLIC_ONLYOFFICE_URL || "http://localhost:8080";

function toDockerAccessibleUrl(url: string): string {
  return url.replace(/localhost/g, "host.docker.internal");
}

export default function OnlyOfficeEditor({
  fileUrl,
  fileId,
  accessToken,
  fileName = "document.docx",
  documentKey,
  mode = "view",
  style,
  className,
}: OnlyOfficeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<{ destroyEditor?: () => void } | null>(null);
  const scriptLoadedRef = useRef(false);

  useEffect(() => {
    if (!fileUrl || !containerRef.current) return;

    let destroyed = false;

    const initEditor = () => {
      if (destroyed || !window.DocsAPI || !containerRef.current) return;

      if (editorRef.current?.destroyEditor) {
        try {
          editorRef.current.destroyEditor();
        } catch {
          // ignore
        }
      }
      containerRef.current.innerHTML = "";

      const editorDiv = document.createElement("div");
      editorDiv.id = `onlyoffice-editor-${documentKey}`;
      editorDiv.style.width = "100%";
      editorDiv.style.height = "100%";
      containerRef.current.appendChild(editorDiv);

      const callbackUrl = toDockerAccessibleUrl(
        `${window.location.origin}/api/onlyoffice/callback?fileId=${encodeURIComponent(fileId)}&token=${encodeURIComponent(accessToken)}`
      );
      const dockerFileUrl = toDockerAccessibleUrl(fileUrl);

      editorRef.current = new window.DocsAPI.DocEditor(editorDiv.id, {
        document: {
          fileType: "docx",
          key: documentKey,
          title: fileName,
          url: dockerFileUrl,
          permissions: {
            edit: mode === "edit",
            download: true,
            print: true,
            review: false,
            comment: false,
          },
        },
        documentType: "word",
        editorConfig: {
          callbackUrl,
          mode,
          lang: "ko",
          customization: {
            autosave: false,
            forcesave: true,
            compactHeader: true,
            compactToolbar: true,
            hideRightMenu: true,
            toolbarNoTabs: true,
          },
        },
        height: "100%",
        width: "100%",
        type: "desktop",
      });
    };

    const loadScript = () => {
      if (window.DocsAPI) {
        initEditor();
        return;
      }

      if (scriptLoadedRef.current) {
        const interval = setInterval(() => {
          if (window.DocsAPI) {
            clearInterval(interval);
            initEditor();
          }
        }, 200);
        return;
      }

      scriptLoadedRef.current = true;
      const script = document.createElement("script");
      script.src = `${ONLYOFFICE_URL}/web-apps/apps/api/documents/api.js`;
      script.async = true;
      script.onload = () => {
        if (!destroyed) initEditor();
      };
      script.onerror = () => {
        console.error(
          "[OnlyOfficeEditor] Failed to load OnlyOffice API script.",
          script.src
        );
      };
      document.head.appendChild(script);
    };

    loadScript();

    return () => {
      destroyed = true;
      if (editorRef.current?.destroyEditor) {
        try {
          editorRef.current.destroyEditor();
        } catch {
          // ignore
        }
        editorRef.current = null;
      }
    };
  }, [accessToken, fileId, fileUrl, documentKey, fileName, mode]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "#fff",
        borderRadius: 12,
        ...style,
      }}
    />
  );
}
