"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { getTemplateFromIDB, saveTemplateToIDB } from "@/lib/templateStore";
import styles from "./result.module.css";

type TemplateType = "레포트" | "실험보고서" | "논문" | "강의노트" | "문헌고찰";
type ChatMsg = { role: "ai" | "user"; text: string };
type LabelMapping = { label: string; value: string };

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

const Workspace = dynamic(() => Promise.resolve(WorkspaceImpl), { ssr: false });

export default function ResultPage() {
  return (
    <Suspense fallback={<div style={{ padding: 20 }}>로딩 중...</div>}>
      <Workspace />
    </Suspense>
  );
}

function WorkspaceImpl() {
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
    { role: "ai", text: "DOCX 템플릿 로딩 후, PDF/DOCX 업로드로 자동 채움이 가능합니다." },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [originalDocxUrl, setOriginalDocxUrl] = useState<string>("");

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

  const isOfficeViewerAllowed = useCallback((url: string) => {
    if (!url) return false;
    try {
      const parsed = new URL(url, window.location.href);
      if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") return false;
      return parsed.protocol === "https:";
    } catch {
      return false;
    }
  }, []);

  const onlyOfficeUrl = process.env.NEXT_PUBLIC_ONLYOFFICE_URL || "";
  const filePublicBaseUrl = process.env.NEXT_PUBLIC_FILE_BASE_URL || "";
  const onlyOfficeCallbackBaseUrl = process.env.NEXT_PUBLIC_ONLYOFFICE_CALLBACK_BASE_URL || "";

  const getOfficeViewerUrl = useCallback((url: string) => {
    return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;
  }, []);

  const getOnlyOfficeFileName = useCallback((fileUrl: string) => {
    try {
      const parsed = new URL(fileUrl, window.location.href);
      const segments = parsed.pathname.split("/").filter(Boolean);
      return segments[segments.length - 1] || "";
    } catch {
      return "";
    }
  }, []);

  const getOnlyOfficeSrcDoc = useCallback(
    (fileUrl: string) => {
      const safeUrl = encodeURI(fileUrl);
      const fileName = getOnlyOfficeFileName(fileUrl);
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const callbackBase = onlyOfficeCallbackBaseUrl || origin;
      const callbackUrl = fileName
        ? `${callbackBase}/api/onlyoffice/callback?file=${encodeURIComponent(fileName)}`
        : "";
      const docKey = `${fileName || "doc"}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      return [
        "<!DOCTYPE html>",
        "<html>",
        "<head>",
        '  <meta charset="utf-8"/>',
        "  <style>html,body,#placeholder{height:100%;margin:0;}</style>",
        `  <script src="${onlyOfficeUrl}/web-apps/apps/api/documents/api.js"></script>`,
        "</head>",
        "<body>",
        '  <div id="placeholder"></div>',
        "  <script>",
        `    const config = {`,
        `      document: {`,
        `        fileType: "docx",`,
        `        title: "Uploaded Template",`,
        `        url: "${safeUrl}",`,
        `        key: "${docKey}"`,
        `      },`,
        `      editorConfig: {`,
        `        mode: "edit",`,
        `        lang: "ko",`,
        `        customization: {`,
        `          compactToolbar: false`,
        `        }`,
        `      }`,
        `    };`,
        callbackUrl ? `    config.editorConfig.callbackUrl = "${callbackUrl}";` : "",
        "    // eslint-disable-next-line no-undef",
        "    new DocsAPI.DocEditor('placeholder', config);",
        "  </script>",
        "</body>",
        "</html>",
      ].join(\"\\n\");
    },
    [getOnlyOfficeFileName, onlyOfficeCallbackBaseUrl, onlyOfficeUrl]
  );

  const uploadTemplateToStorage = useCallback(async (file: File) => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (supabaseUrl && supabaseKey) {
      const bucket = process.env.NEXT_PUBLIC_TEMPLATE_BUCKET || "docx-templates";
      const { supabase } = await import("@/lib/supabase");
      if (!supabase?.storage) throw new Error("Supabase storage client가 없습니다.");
      const safeName = file.name.replace(/\s+/g, "_");
      const path = `templates/${Date.now()}_${safeName}`;
      const { error } = await supabase.storage.from(bucket).upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (error) throw error;
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      if (!data?.publicUrl) throw new Error("공개 URL 생성 실패");
      return data.publicUrl;
    }

    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/templates/upload", {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new Error("로컬 업로드 실패");
    const data = (await res.json()) as { publicUrl?: string };
    if (!data.publicUrl) throw new Error("로컬 공개 URL 생성 실패");
    return data.publicUrl;
  }, []);

  const loadDocxArrayBufferToHtml = useCallback(async (arrayBuffer: ArrayBuffer) => {
    // mammoth는 동적 import가 안전합니다.
    const mammoth = await import("mammoth");
    const result = await mammoth.convertToHtml({ arrayBuffer });
    return normalizeTemplateHTML(result.value || "").trim();
  }, []);

  const analyzeTemplateHTML = useCallback((html: string) => {
    if (!html) return { headings: [], tableCount: 0, labeledFields: [] };
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const headings = Array.from(doc.querySelectorAll("h1,h2,h3,h4,h5,h6"))
      .map((el) => el.textContent?.trim())
      .filter(Boolean) as string[];
    const tableCount = doc.querySelectorAll("table").length;
    const labeledFields = Array.from(doc.querySelectorAll("p,li,td"))
      .map((el) => el.textContent?.trim() || "")
      .filter((text) => /[:：]$/.test(text) || /(작성|입력|성명|학번|날짜)/.test(text))
      .slice(0, 16);
    return { headings, tableCount, labeledFields };
  }, []);

  const applyLabelMappingToHtml = useCallback((html: string, mappings: LabelMapping[]) => {
    if (!html || !mappings.length) return html;
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const labelMap = new Map(
      mappings
        .map((m) => ({
          label: m.label?.trim(),
          value: m.value?.trim(),
        }))
        .filter((m) => m.label && m.value) as { label: string; value: string }[]
    );
    if (!labelMap.size) return html;

    const textNodes: Text[] = [];
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (node.nodeValue?.trim()) textNodes.push(node);
    }

    textNodes.forEach((node) => {
      const raw = node.nodeValue || "";
      const trimmed = raw.trim();
      if (!trimmed) return;
      const normalized = trimmed.replace(/\s+/g, " ");
      for (const [label, value] of labelMap.entries()) {
        const normalizedLabel = label.replace(/\s+/g, " ");
        if (normalized === normalizedLabel) {
          const span = doc.createElement("span");
          span.textContent = ` ${value}`;
          span.style.fontWeight = "600";
          span.style.color = "#0f172a";
          node.parentNode?.insertBefore(span, node.nextSibling);
          labelMap.delete(label);
          break;
        }
      }
    });

    return normalizeTemplateHTML(doc.body.innerHTML || "").trim();
  }, []);

  const extractPdfText = useCallback(async (file: File) => {
   const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
if (pdfjs.GlobalWorkerOptions) {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();
}


    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    let text = "";

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .trim();
      if (pageText) text += `${pageText}\n`;
    }

    return text.trim();
  }, []);

  const extractDocxText = useCallback(async (file: File) => {
    const mammoth = await import("mammoth");
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return (result.value || "").trim();
  }, []);

  const stripCodeFence = (value: string) => {
    const trimmed = value.trim();
    const fenceMatch = trimmed.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/i);
    return fenceMatch ? fenceMatch[1].trim() : trimmed;
  };

  const stripJsonFence = (value: string) => {
    const trimmed = value.trim();
    const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenceMatch ? fenceMatch[1].trim() : trimmed;
  };

  const [templateAnalysis, setTemplateAnalysis] = useState<{
    headings: string[];
    tableCount: number;
    labeledFields: string[];
  }>({ headings: [], tableCount: 0, labeledFields: [] });

  const applyAiToTemplate = useCallback(
    async (sourceText: string, userRequest?: string) => {
      if (!sourceText) {
        setMessages((prev) => [...prev, { role: "ai", text: "분석할 텍스트가 비어 있습니다." }]);
        return;
      }

      setIsLoading(true);
      setLoadError(null);
      setLoadingMessage("AI가 템플릿을 채우는 중...");

      try {
        const prompt = [
          "다음은 사용자 자료 텍스트입니다:",
          sourceText,
          "",
          "다음은 현재 편집 템플릿 HTML입니다:",
          docHTML || "(빈 템플릿)",
          "",
          templateAnalysis.headings.length
            ? `템플릿 구성 요소: 제목(${templateAnalysis.headings.join(" / ")}), 표 ${templateAnalysis.tableCount}개, 필드 후보(${templateAnalysis.labeledFields.join(
                ", "
              )})`
            : "템플릿 구성 요소: 분석 결과 없음",
          "",
          userRequest ? `사용자 요청: ${userRequest}` : null,
          "",
          "필드 후보와 텍스트를 참고해 각 필드에 들어갈 값만 JSON 배열로 작성하세요.",
          '형식: [{"label":"필드명","value":"채울값"}]',
          "반환은 JSON만, 다른 설명은 포함하지 마세요.",
        ]
          .filter(Boolean)
          .join("\n");

        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, type }),
        });
        if (!res.ok) throw new Error("AI 응답 실패");

        const data = await res.json();
        const raw = String(data.result || "");
        let nextHtml = docHTML;
        let applied = false;
        try {
          const jsonText = stripJsonFence(raw);
          const parsed = JSON.parse(jsonText) as LabelMapping[];
          if (Array.isArray(parsed) && parsed.length) {
            nextHtml = applyLabelMappingToHtml(docHTML, parsed);
            applied = true;
          }
        } catch (jsonErr) {
          console.warn("라벨 매핑 JSON 파싱 실패", jsonErr);
        }

        if (!applied) {
          const html = stripCodeFence(raw);
          if (!html) throw new Error("AI 결과가 비어있습니다.");
          nextHtml = html;
        }

        setDocHTML(nextHtml);
        sendHtmlToIframe(nextHtml);
        setMessages((prev) => [
          ...prev,
          { role: "ai", text: applied ? "필드 매핑 기반 자동 채움 완료." : "템플릿 자동 채움 완료." },
        ]);
      } catch (err) {
        console.error(err);
        setLoadError("AI 템플릿 채움 실패. 콘솔(F12) 확인.");
        setMessages((prev) => [...prev, { role: "ai", text: "AI 템플릿 채움 실패. 콘솔(F12) 확인." }]);
      } finally {
        setIsLoading(false);
        setLoadingMessage(null);
      }
    },
    [applyLabelMappingToHtml, docHTML, sendHtmlToIframe, templateAnalysis, type]
  );

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

        let nextOriginalUrl = "";
        if (activeTemplateId) {
          const rec = await getTemplateFromIDB(activeTemplateId);
          if (!rec?.buffer) throw new Error("IDB에서 DOCX 템플릿을 찾지 못했습니다.");
          buf = rec.buffer;
          nextOriginalUrl = rec.publicUrl || "";
        } else {
          const fileName = TYPE_TO_DEFAULT_DOCX[type] || "report";
          const res = await fetch(`/templates/${fileName}.docx`, { cache: "no-store" });
          if (!res.ok) throw new Error(`기본 템플릿 로드 실패: /templates/${fileName}.docx (HTTP ${res.status})`);
          buf = await res.arrayBuffer();
          if (typeof window !== "undefined") {
            const base = filePublicBaseUrl || window.location.origin;
            nextOriginalUrl = new URL(`/templates/${fileName}.docx`, base).toString();
          }
        }

        const html = await loadDocxArrayBufferToHtml(buf);
        if (!html) throw new Error("DOCX 변환 결과가 비어있습니다.");

        const analysis = analyzeTemplateHTML(html);
        setDocHTML(html);
        setTemplateAnalysis(analysis);
        sendHtmlToIframe(html);
        setOriginalDocxUrl(nextOriginalUrl);
        if (nextOriginalUrl && !onlyOfficeUrl && !isOfficeViewerAllowed(nextOriginalUrl)) {
          setMessages((prev) => [
            ...prev,
            {
              role: "ai",
              text: "원본 미리보기는 HTTPS 공개 URL에서만 가능합니다. 현재 환경에서는 편집 보기로 표시됩니다.",
            },
          ]);
        }
        setLoadingMessage(null);

        setMessages((prev) => [
          ...prev,
          {
            role: "ai",
            text: `템플릿 적용 완료. (templateId=${
              activeTemplateId ? "있음" : "없음"
            }) 요소: 제목 ${analysis.headings.length}개, 표 ${analysis.tableCount}개`,
          },
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
  }, [
    frameReady,
    type,
    activeTemplateId,
    loadDocxArrayBufferToHtml,
    analyzeTemplateHTML,
    sendHtmlToIframe,
    docHTML,
  ]);

  const onUploadDocxTemplateHere = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.currentTarget;
      const file = input.files?.[0];
      if (!file) return;

      setIsLoading(true);
      setLoadError(null);
      setLoadingMessage("DOCX 템플릿 적용 중...");
      setMessages((prev) => [...prev, { role: "ai", text: "DOCX 업로드 템플릿 적용 중..." }]);

      try {
        const buf = await file.arrayBuffer();
        const html = await loadDocxArrayBufferToHtml(buf);
        if (!html) throw new Error("DOCX 변환 결과가 비어있습니다.");

        const analysis = analyzeTemplateHTML(html);
        setDocHTML(html);
        setTemplateAnalysis(analysis);
        sendHtmlToIframe(html);

        let publicUrl = "";
        try {
          publicUrl = await uploadTemplateToStorage(file);
        } catch (uploadErr) {
          console.warn("템플릿 업로드 실패. 원본 미리보기 제한됨", uploadErr);
        }

        const newId = await saveTemplateToIDB(file.name, buf, publicUrl || undefined);
        setActiveTemplateId(newId);
        loadedKeyRef.current = `${type}::${newId}`;
        router.replace(
          `/project/new/result?type=${encodeURIComponent(type)}&templateId=${encodeURIComponent(newId)}`
        );
        setOriginalDocxUrl(publicUrl);
        if (publicUrl && !onlyOfficeUrl && !isOfficeViewerAllowed(publicUrl)) {
          setMessages((prev) => [
            ...prev,
            {
              role: "ai",
              text: "원본 미리보기는 HTTPS 공개 URL에서만 가능합니다. 현재 환경에서는 편집 보기로 표시됩니다.",
            },
          ]);
        }
      } catch (err) {
        console.error(err);
        setLoadError("DOCX 업로드/저장 실패. 콘솔(F12) 확인.");
        setMessages((prev) => [...prev, { role: "ai", text: "DOCX 업로드/저장 실패. 콘솔(F12) 확인." }]);
      } finally {
        input.value = "";
        setIsLoading(false);
        setLoadingMessage(null);
      }
    },
    [
      loadDocxArrayBufferToHtml,
      analyzeTemplateHTML,
      router,
      sendHtmlToIframe,
      type,
      uploadTemplateToStorage,
    ]
  );

  // PDF 업로드는 네 기존 자동채움 로직을 여기 붙이면 됩니다.
  const onUploadPdf = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.currentTarget;
      const file = input.files?.[0];
      if (!file) return;

      setMessages((prev) => [...prev, { role: "ai", text: `PDF 업로드됨: ${file.name}` }]);

      try {
        const isDocx = file.name.toLowerCase().endsWith(".docx");
        const extractedText = isDocx ? await extractDocxText(file) : await extractPdfText(file);
        setSourceText(extractedText);
        await applyAiToTemplate(extractedText);
      } catch (err) {
        console.error(err);
        setLoadError("PDF 분석 실패. 콘솔(F12) 확인.");
        setMessages((prev) => [...prev, { role: "ai", text: "PDF 분석 실패. 콘솔(F12) 확인." }]);
      } finally {
        input.value = "";
      }
    },
    [applyAiToTemplate, extractDocxText, extractPdfText]
  );

  const onChatSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const input = chatInput.trim();
      if (!input) return;

      setChatInput("");
      setMessages((prev) => [...prev, { role: "user", text: input }]);

      await applyAiToTemplate(sourceText, input);
    },
    [applyAiToTemplate, chatInput, sourceText]
  );

  const iframeSrcDoc = useMemo(() => IFRAME_SRC_DOC, []);
  const onlyOfficeSrcDoc = useMemo(() => {
    if (!onlyOfficeUrl || !originalDocxUrl) return "";
    return getOnlyOfficeSrcDoc(originalDocxUrl);
  }, [getOnlyOfficeSrcDoc, onlyOfficeUrl, originalDocxUrl]);

  const viewerSrc = useMemo(() => {
    if (!originalDocxUrl) return "";
    if (!isOfficeViewerAllowed(originalDocxUrl)) return "";
    return getOfficeViewerUrl(originalDocxUrl);
  }, [getOfficeViewerUrl, isOfficeViewerAllowed, originalDocxUrl]);

  return (
    <div className={styles.page}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          WORKSPACE
          <div className={styles.sidebarHeaderMeta}>현재 템플릿: {type}</div>
        </div>

        <div className={styles.uploadSection}>
          <div className={styles.uploadButtons}>
            <label className={styles.docxUpload}>
              DOCX 템플릿 업로드
              <input type="file" accept=".docx" hidden onChange={onUploadDocxTemplateHere} />
            </label>

            <label className={styles.pdfUpload}>
              PDF/DOCX 업로드
              <input type="file" accept=".pdf,.docx" hidden onChange={onUploadPdf} />
            </label>
          </div>

          {isLoading && <div className={styles.loadingNote}>{loadingMessage || "처리 중..."}</div>}
        </div>

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

        <form onSubmit={onChatSubmit} className={styles.chatForm}>
          <textarea
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="AI에게 수정 요청을 입력하세요..."
            rows={3}
            className={styles.chatInput}
          />
          <button type="submit" className={styles.chatButton}>
            요청 보내기
          </button>
        </form>
      </aside>

      <main className={styles.main}>
        <div className={styles.editorWrapper}>
          {onlyOfficeSrcDoc ? (
            <iframe
              title="원본 편집"
              srcDoc={onlyOfficeSrcDoc}
              className={styles.editorFrame}
            />
          ) : viewerSrc ? (
            <iframe title="원본 미리보기" src={viewerSrc} className={styles.editorFrame} />
          ) : (
            <iframe ref={iframeRef} srcDoc={iframeSrcDoc} className={styles.editorFrame} />
          )}
          {(isLoading || loadError) && (
            <div className={styles.overlay}>
              <div className={styles.overlayContent}>
                <div className={styles.overlayTitle}>
                  {loadError || loadingMessage || "AI 레포트를 분석하는 중..."}
                </div>
                <div className={styles.overlaySubtitle}>잠시만 기다려 주세요.</div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
