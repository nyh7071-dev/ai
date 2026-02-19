"use client";

import type React from "react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import styles from "./result.module.css";

// OnlyOffice 편집기 (클라이언트 전용)
const OnlyOfficeEditor = dynamic(() => import("@/components/OnlyOfficeEditor"), {
  ssr: false,
  loading: () => <div style={{ padding: 40, textAlign: "center" }}>편집기 로딩 중...</div>
});

type FileType = "docx" | "pdf" | null;
type ChatMsg = { role: "ai" | "user"; text: string };

interface FormField {
  id: string;
  label: string;
  type: "text" | "date" | "number" | "multiline";
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
  value: string;
  placeholder?: string;
}

export default function ResultPage() {
  return (
    <Suspense fallback={<div style={{ padding: 20 }}>로딩 중...</div>}>
      <Workspace />
    </Suspense>
  );
}

function Workspace() {
  const sp = useSearchParams();
  const type = sp.get("type") || "문서";

  // 파일 상태
  const [fileType, setFileType] = useState<FileType>(null);
  const [fileName, setFileName] = useState<string>("");
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null);

  // PDF 관련
  const pdfCanvasRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.5);

  // DOCX 관련
  const docxPreviewRef = useRef<HTMLDivElement>(null);
  const docxContainerRef = useRef<HTMLDivElement>(null);
  const [docxHtml, setDocxHtml] = useState<string>("");
  const [docxSize, setDocxSize] = useState({ width: 0, height: 0 });

  // 공통 상태
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 텍스트 추출 (AI 분석용)
  const [extractedText, setExtractedText] = useState<string>("");
  const [sourceText, setSourceText] = useState<string>("");

  // 채팅
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: "ai", text: "DOCX 파일을 업로드하세요. AI가 양식을 분석하고 자동으로 작성합니다." },
  ]);
  const [chatInput, setChatInput] = useState("");

  // PDF 편집 필드
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  // PDF 텍스트 오버레이 (실시간 편집용)
  const [pdfTextItems, setPdfTextItems] = useState<Array<{
    id: string;
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
    page: number;
  }>>([]);

  // AI 생성 결과
  const [aiGeneratedContent, setAiGeneratedContent] = useState<string>("");

  // Write Ops 스켈레톤 (xmlPath 매핑)
  const [templateWriteOps, setTemplateWriteOps] = useState<Array<{
    xmlPath: string;
    key: string;
    slot: string;
    value?: string;
  }> | null>(null);

  // ========== PDF 처리 ==========
  const renderPdfPage = useCallback(async (pageNum: number) => {
    if (!pdfDocRef.current || !pdfCanvasRef.current) return;

    try {
      const page = await pdfDocRef.current.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      // 기존 캔버스 제거
      const existingCanvas = pdfCanvasRef.current.querySelector("canvas");
      if (existingCanvas) existingCanvas.remove();

      // 새 캔버스 생성
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      canvas.style.display = "block";
      canvas.style.boxShadow = "0 4px 20px rgba(0, 0, 0, 0.3)";
      canvas.style.background = "#fff";

      pdfCanvasRef.current.style.width = `${viewport.width}px`;
      pdfCanvasRef.current.style.height = `${viewport.height}px`;

      pdfCanvasRef.current.insertBefore(canvas, pdfCanvasRef.current.firstChild);
      setCanvasSize({ width: viewport.width, height: viewport.height });

      // 렌더링
      await page.render({ canvasContext: context, viewport }).promise;

      // 텍스트 레이어 추출 (실시간 편집용)
      const textContent = await page.getTextContent();
      const textItems = textContent.items.map((item: any, idx: number) => {
        const tx = item.transform;
        const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
        const x = tx[4] * scale;
        const y = viewport.height - (tx[5] * scale) - (fontHeight * scale);

        return {
          id: `text-${pageNum}-${idx}`,
          text: item.str,
          x,
          y,
          width: item.width * scale,
          height: fontHeight * scale,
          fontSize: fontHeight * scale,
          page: pageNum,
        };
      }).filter((item: any) => item.text.trim());

      setPdfTextItems(textItems);

    } catch (err) {
      console.error("PDF 페이지 렌더링 실패:", err);
    }
  }, [scale]);

  const loadPdf = useCallback(async (arrayBuffer: ArrayBuffer) => {
    setIsLoading(true);
    setLoadingMessage("PDF 로딩 중...");
    setLoadError(null);

    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      pdfDocRef.current = pdf;

      setTotalPages(pdf.numPages);
      setCurrentPage(1);
      setFileType("pdf");

      await renderPdfPage(1);

      // 전체 텍스트 추출
      let fullText = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        fullText += textContent.items.map((item: any) => item.str).join(" ") + "\n";
      }
      setExtractedText(fullText.trim());

      setMessages(prev => [...prev, {
        role: "ai",
        text: `PDF 로드 완료! (${pdf.numPages}페이지)\n\n"AI 양식 분석" 버튼을 클릭하면 입력 필드를 자동으로 찾아드립니다.`
      }]);

    } catch (err) {
      console.error("PDF 로드 실패:", err);
      setLoadError("PDF 로드 실패");
    } finally {
      setIsLoading(false);
      setLoadingMessage(null);
    }
  }, [renderPdfPage]);

  // 페이지 변경 시 렌더링
  useEffect(() => {
    if ((fileType === "pdf" || fileType === "docx") && currentPage > 0) {
      renderPdfPage(currentPage);
    }
  }, [currentPage, fileType, renderPdfPage, scale]);

  // OnlyOffice 관련 상태
  const [docxFileUrl, setDocxFileUrl] = useState<string>("");
  const [docxTimestamp, setDocxTimestamp] = useState<number>(0);

  // OnlyOffice 관련 상태
  const [onlyOfficeFileId, setOnlyOfficeFileId] = useState<string>("");

  // ========== DOCX 처리 (OnlyOffice 실시간 편집) ==========
  const loadDocxWithOnlyOffice = useCallback(async (arrayBuffer: ArrayBuffer, fileName: string) => {
    setIsLoading(true);
    setLoadingMessage("OnlyOffice로 파일 업로드 중...");
    setLoadError(null);

    try {
      setFileBuffer(arrayBuffer);

      // 텍스트 추출 (AI 분석용 - 구조 정보 포함)
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(arrayBuffer);
      const documentXml = await zip.file("word/document.xml")?.async("string");

      let extractedTextLength = 0;

      if (documentXml) {
        // XML에서 텍스트와 함께 구조 정보 추출
        const textNodes = documentXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
        const extractedParts: string[] = [];

        textNodes.forEach(node => {
          const text = node.replace(/<w:t[^>]*>|<\/w:t>/g, "");
          if (text.trim()) {
            extractedParts.push(text);
          }
        });

        // 컨텍스트가 있는 형태로 저장 (AI가 패턴을 더 잘 인식)
        const structuredText = extractedParts.join(" ");
        setExtractedText(structuredText);
        extractedTextLength = structuredText.length;

        console.log("[DOCX 분석] 추출된 텍스트 샘플:", structuredText.substring(0, 500));
      } else {
        // fallback: mammoth로 추출
        const mammoth = await import("mammoth");
        const textResult = await mammoth.extractRawText({ arrayBuffer });
        setExtractedText(textResult.value.trim());
        extractedTextLength = textResult.value.length;
      }

      // OnlyOffice에 파일 업로드
      const formData = new FormData();
      const blob = new Blob([arrayBuffer], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      });
      formData.append("file", blob, fileName);

      const response = await fetch("/api/onlyoffice/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "알 수 없는 오류" }));
        throw new Error(`업로드 실패: ${errorData.error || response.statusText}`);
      }

      const data = await response.json();
      setOnlyOfficeFileId(data.fileId);
      setFileName(fileName);
      setFileType("docx");

      setMessages(prev => [...prev, {
        role: "ai",
        text: `DOCX 로드 완료! OnlyOffice로 실시간 편집이 가능합니다.\n${extractedTextLength}자\n\nWord처럼 문서를 직접 편집할 수 있습니다.`
      }]);

    } catch (err) {
      console.error("OnlyOffice 로드 실패:", err);
      setLoadError("OnlyOffice 로드 실패");
      setMessages(prev => [...prev, {
        role: "ai",
        text: "OnlyOffice 로드 실패. OnlyOffice Document Server가 실행 중인지 확인해주세요."
      }]);
    } finally {
      setIsLoading(false);
      setLoadingMessage(null);
    }
  }, []);

  // ========== DOCX 처리 (PDF 변환 + 오버레이 편집) ==========
  const loadDocx = useCallback(async (arrayBuffer: ArrayBuffer, fileName: string) => {
    setIsLoading(true);
    setLoadingMessage("DOCX를 PDF로 변환 중... (Docker + LibreOffice)");
    setLoadError(null);

    try {
      setFileBuffer(arrayBuffer);

      // 먼저 텍스트 추출 (AI 분석용)
      const mammoth = await import("mammoth");
      const textResult = await mammoth.extractRawText({ arrayBuffer });
      setExtractedText(textResult.value.trim());

      // DOCX → PDF 변환 (Docker + LibreOffice)
      const formData = new FormData();
      const blob = new Blob([arrayBuffer], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      });
      formData.append("file", blob, fileName);

      const response = await fetch("/api/docx-to-pdf", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "알 수 없는 오류" }));
        throw new Error(`DOCX → PDF 변환 실패: ${errorData.error || response.statusText}`);
      }

      // 변환된 PDF 로드
      const pdfBuffer = await response.arrayBuffer();

      // PDF.js로 렌더링
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

      const pdf = await pdfjs.getDocument({ data: pdfBuffer }).promise;
      pdfDocRef.current = pdf;

      setTotalPages(pdf.numPages);
      setCurrentPage(1);
      setFileType("docx");

      await renderPdfPage(1);

      setMessages(prev => [...prev, {
        role: "ai",
        text: `DOCX 로드 완료! (원본 100% 동일)\n${pdf.numPages}페이지, ${textResult.value.length}자\n\n"+ 필드 추가" 버튼으로 입력 필드를 추가하거나, "AI 양식 분석" 버튼을 클릭하면 AI가 자동으로 필드를 생성합니다.`
      }]);

    } catch (err) {
      console.error("DOCX 로드 실패:", err);
      setLoadError("DOCX 로드 실패");
      setMessages(prev => [...prev, {
        role: "ai",
        text: "DOCX 로드 실패. Docker가 실행 중인지 확인해주세요."
      }]);
    } finally {
      setIsLoading(false);
      setLoadingMessage(null);
    }
  }, [renderPdfPage]);

  // DOCX는 이미 HTML로 변환되어 docxHtml 상태에 저장됨 (useEffect 불필요)

  // ========== 파일 업로드 ==========
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log("[handleFileUpload] 이벤트 발생", e);
    const file = e.currentTarget.files?.[0];
    console.log("[handleFileUpload] 선택된 파일:", file);
    if (!file) {
      console.log("[handleFileUpload] 파일이 선택되지 않음");
      return;
    }

    setFileName(file.name);
    setFormFields([]);
    setAiGeneratedContent("");
    setMessages(prev => [...prev, { role: "ai", text: `파일 업로드: ${file.name}` }]);
    console.log("[handleFileUpload] 파일 정보 설정 완료:", file.name);

    const arrayBuffer = await file.arrayBuffer();
    setFileBuffer(arrayBuffer);
    const ext = file.name.toLowerCase().split('.').pop();

    if (ext === "docx") {
      // OnlyOffice로 실시간 편집
      await loadDocxWithOnlyOffice(arrayBuffer, file.name);

      // 템플릿 분석: slots 자동 추출
      try {
        console.log("[템플릿 업로드] 템플릿 분석 시작...");

        const analyzeFormData = new FormData();
        analyzeFormData.append('file', file);

        const analyzeResponse = await fetch('/api/docs/analyze', {
          method: 'POST',
          body: analyzeFormData,
        });

        if (analyzeResponse.ok) {
          const analyzeData = await analyzeResponse.json();
          const { slots, debug } = analyzeData;

          // writeOps 생성 (새 API는 writeOps를 직접 반환하지 않음)
          const writeOps = slots.map((slot: any) => ({
            xmlPath: slot.xmlPath,
            key: slot.key,
            slot: slot.label || slot.key,  // AI에게 보여줄 사람이 읽을 수 있는 라벨
            value: '',
            slotType: slot.slotType,
            anchorLabel: slot.anchorLabel,
            currentValue: slot.currentValue || '',  // 현재 플레이스홀더 텍스트
            context: slot.context || '',  // 주변 컨텍스트
          }));

          const count = slots.length;

          if (count === 0) {
            console.warn("[템플릿 업로드] ⚠️ 슬롯을 찾지 못함");
            setMessages(prev => [...prev, {
              role: "ai",
              text: "⚠️ 템플릿에서 채울 슬롯을 찾지 못했습니다.\n\n" +
                   "템플릿에 다음 중 하나가 있어야 합니다:\n" +
                   "1. Content Control (w:sdt) tag\n" +
                   "2. 템플릿 어댑터가 지원하는 템플릿 형식\n\n" +
                   "수동으로 write_ops.json을 업로드하거나 템플릿을 수정하세요."
            }]);
            setTemplateWriteOps(null);
          } else {
            console.log("[템플릿 업로드] ✅ 슬롯 추출 완료:", count, "개");
            console.log("[템플릿 업로드] 슬롯 목록:", slots);
            console.log("[템플릿 업로드] writeOps 샘플:", writeOps.slice(0, 3));
            console.log("[템플릿 업로드] 디버그:", debug);

            setTemplateWriteOps(writeOps);
            setMessages(prev => [...prev, {
              role: "ai",
              text: `✅ 템플릿 분석 완료: ${count}개 슬롯 발견\n\n` +
                   `발견된 슬롯:\n${slots.slice(0, 5).map((s: any) => `• ${s.label} (${s.kind})`).join('\n')}` +
                   `${slots.length > 5 ? `\n...외 ${slots.length - 5}개` : ''}\n\n` +
                   (debug.adapterUsed?.length > 0 ? `어댑터: ${debug.adapterUsed.join(', ')}\n\n` : '') +
                   `이제 참고 자료를 업로드하고 "AI 자동 채우기"를 실행하세요.`
            }]);
          }
        } else {
          throw new Error(`HTTP ${analyzeResponse.status}`);
        }
      } catch (err: any) {
        console.error("[템플릿 업로드] ❌ 템플릿 분석 실패:", err);
        setMessages(prev => [...prev, {
          role: "ai",
          text: `⚠️ 템플릿 분석 실패: ${err.message}\n\n수동으로 write_ops.json을 업로드하세요.`
        }]);
      }
    } else {
      setLoadError("DOCX 파일만 지원합니다.");
      setMessages(prev => [...prev, { role: "ai", text: "DOCX 파일만 업로드 가능합니다." }]);
    }

    if (e.currentTarget) e.currentTarget.value = "";
  }, [loadDocxWithOnlyOffice]);

  // ========== 자료 업로드 ==========
  const handleSourceUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setLoadingMessage("자료 분석 중...");
    setMessages(prev => [...prev, { role: "ai", text: `자료 업로드: ${file.name}` }]);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const ext = file.name.toLowerCase().split('.').pop();
      let text = "";

      if (ext === "pdf") {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
        const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          text += content.items.map((item: any) => item.str).join(" ") + "\n";
        }
      } else if (ext === "docx") {
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ arrayBuffer });
        text = result.value;
      } else if (ext === "txt") {
        text = new TextDecoder().decode(arrayBuffer);
      }

      setSourceText(text.trim());
      setMessages(prev => [...prev, {
        role: "ai",
        text: `자료에서 ${text.length}자 추출 완료!\n\n"AI 자동 채우기" 버튼을 클릭하면 양식을 자동으로 작성합니다.`
      }]);

    } catch (err) {
      console.error("자료 분석 실패:", err);
      setMessages(prev => [...prev, { role: "ai", text: "자료 분석에 실패했습니다." }]);
    } finally {
      if (e.currentTarget) e.currentTarget.value = "";
      setIsLoading(false);
      setLoadingMessage(null);
    }
  }, []);

  // ========== Write Ops 스켈레톤 업로드 ==========
  const handleWriteOpsUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const ops = JSON.parse(text);

      if (!Array.isArray(ops)) {
        throw new Error("write_ops는 배열이어야 합니다");
      }

      setTemplateWriteOps(ops);
      setMessages(prev => [...prev, {
        role: "ai",
        text: `Write Ops 스켈레톤 로드 완료: ${ops.length}개 슬롯`
      }]);
      console.log("[Write Ops] 로드 완료:", ops.length, "개 슬롯");
      console.log("[Write Ops] 샘플:", ops.slice(0, 3));
    } catch (err: any) {
      console.error("Write Ops 로드 실패:", err);
      setMessages(prev => [...prev, {
        role: "ai",
        text: `Write Ops JSON 파싱 실패: ${err.message}`
      }]);
    } finally {
      if (e.currentTarget) e.currentTarget.value = "";
    }
  }, []);

  // ========== AI 양식 분석 ==========
  const analyzeForm = useCallback(async () => {
    if (!extractedText) {
      setMessages(prev => [...prev, { role: "ai", text: "먼저 양식 파일을 업로드해주세요." }]);
      return;
    }

    setIsLoading(true);
    setLoadingMessage("AI가 양식을 분석 중...");

    try {
      const res = await fetch("/api/analyze-form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "analyze", formText: extractedText })
      });

      const data = await res.json();

      if (data.fields && data.fields.length > 0) {
        const newFields: FormField[] = data.fields.map((f: any, idx: number) => ({
          id: `field-${Date.now()}-${idx}`,
          label: f.label,
          type: f.type || "text",
          x: 50,
          y: 80 + idx * 50,
          width: 250,
          height: f.type === "multiline" ? 80 : 30,
          page: 1,
          value: "",
          placeholder: f.placeholder || ""
        }));

        setFormFields(newFields);

        setMessages(prev => [...prev, {
          role: "ai",
          text: `양식 분석 완료!\n\n양식 종류: ${data.formType || "알 수 없음"}\n${data.summary || ""}\n\n발견된 필드 ${newFields.length}개:\n${newFields.map(f => `• ${f.label}`).join("\n")}\n\n필드를 드래그하여 위치를 조정하세요.`
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: "ai",
          text: "입력 필드를 찾지 못했습니다. '+ 필드 추가' 버튼으로 직접 추가하세요."
        }]);
      }

    } catch (err) {
      console.error("양식 분석 실패:", err);
      setMessages(prev => [...prev, { role: "ai", text: "양식 분석에 실패했습니다." }]);
    } finally {
      setIsLoading(false);
      setLoadingMessage(null);
    }
  }, [extractedText]);

  // ========== AI 자동 채우기 ==========
  const autoFillForm = useCallback(async () => {
    if (!extractedText) {
      setMessages(prev => [...prev, { role: "ai", text: "먼저 양식 파일을 업로드해주세요." }]);
      return;
    }

    if (!sourceText) {
      setMessages(prev => [...prev, { role: "ai", text: "참고 자료를 업로드해주세요." }]);
      return;
    }

    setIsLoading(true);
    setLoadingMessage("AI가 내용을 작성 중...");

    try {
      const res = await fetch("/api/analyze-form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "fill",
          formText: extractedText,
          sourceText: sourceText,
          formStructure: formFields
        })
      });

      const data = await res.json();

      if (data.filledFields && data.filledFields.length > 0) {
        // 필드 값 업데이트
        setFormFields(prev => prev.map(field => {
          const filled = data.filledFields.find((f: any) =>
            f.label.toLowerCase().includes(field.label.toLowerCase()) ||
            field.label.toLowerCase().includes(f.label.toLowerCase())
          );
          return filled ? { ...field, value: filled.value } : field;
        }));

        setAiGeneratedContent(data.filledFields.map((f: any) => `${f.label}: ${f.value}`).join("\n\n"));

        setMessages(prev => [...prev, {
          role: "ai",
          text: `자동 채우기 완료!\n\n${data.filledFields.length}개 필드가 채워졌습니다.\n${data.suggestions ? `\n${data.suggestions}` : ""}`
        }]);
      } else {
        // 일반 AI 생성
        const genRes = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: `양식 내용:\n${extractedText}\n\n참고 자료:\n${sourceText}\n\n위 양식을 참고 자료를 바탕으로 작성해주세요.`,
            type
          })
        });

        const genData = await genRes.json();
        setAiGeneratedContent(genData.result || "");

        setMessages(prev => [...prev, {
          role: "ai",
          text: `AI가 내용을 생성했습니다!\n\n"AI 내용 삽입" 버튼을 클릭하면 문서에 삽입됩니다.`
        }]);
      }

    } catch (err) {
      console.error("자동 채우기 실패:", err);
      setMessages(prev => [...prev, { role: "ai", text: "자동 채우기에 실패했습니다." }]);
    } finally {
      setIsLoading(false);
      setLoadingMessage(null);
    }
  }, [extractedText, sourceText, formFields, type]);

  // ========== AI 내용 삽입 ==========
  const insertAiContent = useCallback(() => {
    if (!aiGeneratedContent) {
      setMessages(prev => [...prev, { role: "ai", text: "삽입할 AI 생성 내용이 없습니다." }]);
      return;
    }

    // AI 내용을 클립보드에 복사
    navigator.clipboard.writeText(aiGeneratedContent);
    setMessages(prev => [...prev, {
      role: "ai",
      text: "AI 내용이 클립보드에 복사되었습니다.\n\n필드를 추가하고 Ctrl+V로 붙여넣기하세요."
    }]);
  }, [aiGeneratedContent]);

  // ========== 필드 관리 ==========
  const addField = useCallback(() => {
    const newField: FormField = {
      id: `field-${Date.now()}`,
      label: `필드 ${formFields.length + 1}`,
      type: "text",
      x: 50,
      y: 80 + formFields.length * 50,
      width: 200,
      height: 30,
      page: currentPage,
      value: "",
      placeholder: "내용 입력"
    };
    setFormFields(prev => [...prev, newField]);
    setSelectedField(newField.id);
  }, [formFields.length, currentPage]);

  const handleFieldChange = useCallback((id: string, value: string) => {
    setFormFields(prev => prev.map(f => f.id === id ? { ...f, value } : f));
  }, []);

  const handleFieldDrag = useCallback((id: string, x: number, y: number) => {
    setFormFields(prev => prev.map(f => f.id === id ? { ...f, x, y } : f));
  }, []);

  const deleteField = useCallback((id: string) => {
    setFormFields(prev => prev.filter(f => f.id !== id));
    if (selectedField === id) setSelectedField(null);
  }, [selectedField]);

  // PDF 텍스트 직접 편집
  const handlePdfTextChange = useCallback((id: string, newText: string) => {
    setPdfTextItems(prev => prev.map(item =>
      item.id === id ? { ...item, text: newText } : item
    ));
  }, []);

  // ========== PDF 저장 ==========
  const savePdf = useCallback(async () => {
    if (!fileBuffer || fileType !== "pdf") {
      setMessages(prev => [...prev, { role: "ai", text: "저장할 PDF가 없습니다." }]);
      return;
    }

    setIsLoading(true);
    setLoadingMessage("PDF 저장 중...");

    try {
      const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");
      const pdfDoc = await PDFDocument.load(fileBuffer);
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const pages = pdfDoc.getPages();

      for (const field of formFields) {
        if (!field.value || field.page > pages.length) continue;
        const page = pages[field.page - 1];
        const { height } = page.getSize();
        const pdfX = field.x / scale;
        const pdfY = height - (field.y / scale) - 15;

        page.drawText(field.value, {
          x: pdfX,
          y: pdfY,
          size: 11,
          font,
          color: rgb(0, 0, 0),
        });
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = fileName?.replace(".pdf", "_filled.pdf") || "filled.pdf";
      a.click();
      URL.revokeObjectURL(url);

      setMessages(prev => [...prev, { role: "ai", text: "PDF 저장 완료!" }]);

    } catch (err) {
      console.error("PDF 저장 실패:", err);
      setMessages(prev => [...prev, { role: "ai", text: "PDF 저장에 실패했습니다." }]);
    } finally {
      setIsLoading(false);
      setLoadingMessage(null);
    }
  }, [fileBuffer, fileType, formFields, scale, fileName]);

  // ========== DOCX 저장 (원본에 필드 값 삽입) ==========
  const saveDocx = useCallback(async () => {
    if (!fileBuffer) {
      setMessages(prev => [...prev, { role: "ai", text: "저장할 파일이 없습니다." }]);
      return;
    }

    if (formFields.length === 0 || !formFields.some(f => f.value)) {
      setMessages(prev => [...prev, { role: "ai", text: "입력된 필드가 없습니다." }]);
      return;
    }

    setIsLoading(true);
    setLoadingMessage("DOCX 저장 중...");

    try {
      // 원본 DOCX에 필드 값 삽입
      const docxBuffer = Buffer.from(fileBuffer).toString("base64");

      const response = await fetch("/api/save-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docxBuffer,
          fields: formFields.filter(f => f.value),
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "DOCX 저장 실패");
      }

      // Base64를 Blob으로 변환
      const binaryString = atob(data.docx);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      // 다운로드
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName?.replace(".docx", "_filled.docx") || "filled.docx";
      a.click();
      URL.revokeObjectURL(url);

      setMessages(prev => [...prev, { role: "ai", text: "DOCX 저장 완료!" }]);

    } catch (err: any) {
      console.error("DOCX 저장 실패:", err);
      setMessages(prev => [...prev, { role: "ai", text: `DOCX 저장 실패: ${err.message}` }]);
    } finally {
      setIsLoading(false);
      setLoadingMessage(null);
    }
  }, [fileBuffer, formFields, fileName]);

  // ========== 채팅 ==========
  const handleChatSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const input = chatInput.trim();
    if (!input) return;

    setChatInput("");
    setMessages(prev => [...prev, { role: "user", text: input }]);

    setIsLoading(true);
    try {
      const prompt = `${extractedText ? `현재 양식:\n${extractedText}\n\n` : ""}${sourceText ? `참고 자료:\n${sourceText}\n\n` : ""}사용자 요청: ${input}`;

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, type }),
      });

      const data = await res.json();
      setMessages(prev => [...prev, { role: "ai", text: data.result || "응답 생성 실패" }]);
    } catch {
      setMessages(prev => [...prev, { role: "ai", text: "AI 요청에 실패했습니다." }]);
    } finally {
      setIsLoading(false);
    }
  }, [chatInput, extractedText, sourceText, type]);

  // ========== 네비게이션 ==========
  const goToPrevPage = () => currentPage > 1 && setCurrentPage(currentPage - 1);
  const goToNextPage = () => currentPage < totalPages && setCurrentPage(currentPage + 1);
  const zoomIn = () => setScale(s => Math.min(s + 0.25, 3));
  const zoomOut = () => setScale(s => Math.max(s - 0.25, 0.5));

  // ========== 렌더링 ==========
  return (
    <div className={styles.page}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          WORKSPACE
          <div className={styles.sidebarHeaderMeta}>
            {fileName || "파일을 업로드하세요"}
          </div>
        </div>

        <div className={styles.sidebarBody}>
          {/* 파일 업로드 */}
          <div className={styles.uploadSection}>
            <div className={styles.uploadButtonsColumn}>
              <label
                className={styles.primaryButton}
                style={{ cursor: "pointer", userSelect: "none" }}
                onClick={() => console.log("[Label] 양식 업로드 버튼 클릭됨")}
              >
                양식 업로드 (DOCX)
                <input
                  type="file"
                  accept=".docx"
                  style={{ display: "none" }}
                  onChange={handleFileUpload}
                  onClick={(e) => {
                    console.log("[Input] 파일 input 클릭됨");
                    e.stopPropagation();
                  }}
                />
              </label>
              <label
                className={styles.primaryButton}
                style={{ cursor: "pointer", userSelect: "none" }}
                onClick={() => console.log("[Label] 자료 업로드 버튼 클릭됨")}
              >
                자료 업로드 (PDF/DOCX/TXT)
                <input
                  type="file"
                  accept=".pdf,.docx,.txt"
                  style={{ display: "none" }}
                  onChange={handleSourceUpload}
                  onClick={(e) => {
                    console.log("[Input] 자료 input 클릭됨");
                    e.stopPropagation();
                  }}
                />
              </label>
              <label
                className={styles.primaryButton}
                style={{
                  cursor: "pointer",
                  userSelect: "none",
                  backgroundColor: templateWriteOps ? "#28a745" : "#6c757d",
                  marginTop: "8px",
                }}
                onClick={() => console.log("[Label] Write Ops 업로드 버튼 클릭됨")}
              >
                {templateWriteOps
                  ? `✓ Write Ops 로드됨 (${templateWriteOps.length}개)`
                  : "Write Ops JSON 업로드"}
                <input
                  type="file"
                  accept=".json"
                  style={{ display: "none" }}
                  onChange={handleWriteOpsUpload}
                  onClick={(e) => {
                    console.log("[Input] Write Ops input 클릭됨");
                    e.stopPropagation();
                  }}
                />
              </label>
            </div>
            {isLoading && <div className={styles.loadingNote}>{loadingMessage}</div>}
          </div>

          {/* OnlyOffice 컨트롤 */}
          {fileType === "docx" && onlyOfficeFileId && (
            <div className={styles.uploadSection}>
              <div className={styles.uploadButtonsColumn}>
                <button
onClick={async () => {
                    if (!sourceText) {
                      setMessages(prev => [...prev, { role: "ai", text: "먼저 자료를 업로드해주세요." }]);
                      return;
                    }

                    setIsLoading(true);
                    setLoadingMessage("AI가 DOCX를 자동으로 채우는 중...");
                    console.log("[자동채우기] 시작");

                    try {
                      // 1. 원본 파일 가져오기 (스캐너와 동일한 파일 사용 - 인덱스 일관성 보장)
                      console.log("[자동채우기] 1단계: 원본 파일 버퍼 사용");
                      if (!fileBuffer) {
                        throw new Error("원본 파일 버퍼가 없습니다. 파일을 다시 업로드해주세요.");
                      }
                      const currentFileBlob = new Blob([fileBuffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
                      console.log("[자동채우기] 원본 파일 크기:", currentFileBlob.size);

                      // 2. AI로 내용 생성
                      console.log("[자동채우기] 2단계: AI 내용 생성");

                      // slots 정보 준비 (key 기반 스키마 + 컨텍스트)
                      const slots = templateWriteOps
                        ? templateWriteOps.map((op: any) => ({
                            key: op.key,
                            label: op.slot,
                            currentValue: op.currentValue || '',
                            context: op.context || '',
                            slotType: op.slotType || 'short_text',
                          }))
                        : undefined;

                      console.log("[자동채우기] slots 정보:", slots);

                      const fillResponse = await fetch("/api/analyze-form", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          action: "fill",
                          formText: extractedText,
                          sourceText: sourceText,
                          slots: slots, // key 기반 스키마 활성화
                        })
                      });

                      if (!fillResponse.ok) {
                        throw new Error("AI 내용 생성 실패");
                      }

                      const fillData = await fillResponse.json();
                      console.log("[자동채우기] AI 생성 결과:", fillData);

                      if (!fillData.filledFields || fillData.filledFields.length === 0) {
                        setMessages(prev => [...prev, {
                          role: "ai",
                          text: "참고 자료에서 양식에 맞는 내용을 찾을 수 없습니다. 자료의 내용과 양식이 일치하는지 확인해주세요."
                        }]);
                        return;
                      }

                      // 3. DOCX에 내용 채우기 (서버에서 처리)
                      console.log("[자동채우기] 3단계: DOCX에 내용 채우기");

                      // Write Ops 스켈레톤 확인
                      if (!templateWriteOps || templateWriteOps.length === 0) {
                        setMessages(prev => [...prev, {
                          role: "ai",
                          text: "❌ 템플릿에서 채울 슬롯을 찾지 못했습니다.\n\n" +
                               "다음을 확인하세요:\n" +
                               "1. 템플릿에 {{key}} placeholder가 있는지\n" +
                               "2. Content Control (w:sdt) tag가 있는지\n" +
                               "3. 표 라벨 (창업아이템명, 팀 구성 등)이 있는지\n\n" +
                               "또는 수동으로 write_ops.json 파일을 업로드하세요."
                        }]);
                        return;
                      }

                      // filledFields와 templateWriteOps를 key로 매칭
                      console.log("[자동채우기] AI filledFields 개수:", fillData.filledFields.length);
                      console.log("[자동채우기] templateWriteOps 개수:", templateWriteOps.length);
                      console.log("[자동채우기] AI filledFields keys:", fillData.filledFields.map((f: any) => f.key).slice(0, 10));
                      console.log("[자동채우기] templateWriteOps keys:", templateWriteOps.map((t: any) => t.key).slice(0, 10));

                      // BODY_SECTION 진단 로그
                      const bodySectionOps = templateWriteOps.filter((t: any) => t.key?.startsWith('BODY_SECTION'));
                      const bodySectionAiKeys = fillData.filledFields.filter((f: any) => f.key?.startsWith('BODY_SECTION'));
                      console.log(`[자동채우기] 🔍 BODY_SECTION 진단:`);
                      console.log(`  - 템플릿 BODY_SECTION 슬롯: ${bodySectionOps.length}개`, bodySectionOps.map((t: any) => t.key));
                      console.log(`  - AI 반환 BODY_SECTION: ${bodySectionAiKeys.length}개`, bodySectionAiKeys.map((f: any) => ({ key: f.key, valueLen: f.value?.length || 0 })));

                      const writeOps = fillData.filledFields
                        .map((field: any) => {
                          // 빈 값이면 스킵
                          if (!field.value || field.value.trim() === '') return null;

                          const fieldKey = field.key || field.label;

                          // templateWriteOps에서 key로 매칭
                          const template = templateWriteOps.find(
                            (t: any) => t.key === fieldKey || t.slot === fieldKey
                          );

                          if (!template) {
                            console.warn(
                              `[자동채우기] 매칭 실패: key="${fieldKey}" - write_ops에서 찾을 수 없음`
                            );
                            return null;
                          }

                          console.log(
                            `[자동채우기] 매칭 성공: key="${fieldKey}" → ${template.xmlPath} (값: ${field.value.substring(0, 30)}...)`
                          );

                          return {
                            xmlPath: template.xmlPath,
                            value: field.value,
                          };
                        })
                        .filter((op: { xmlPath: string; value: string } | null): op is { xmlPath: string; value: string } => op !== null);

                      console.log("[자동채우기] writeOps preview:", writeOps.slice(0, 3));
                      console.log("[자동채우기] writeOps length:", writeOps.length);
                      console.log("sending template:", fileName, currentFileBlob.size);
                      console.log("sending ops count:", writeOps.length);
                      console.log("skipEmpty:", true);

                      // ops가 배열인지 검증
                      if (!Array.isArray(writeOps) || writeOps.length === 0) {
                        console.error("[자동채우기] ❌ 매칭 실패");
                        console.error("  - AI filledFields:", fillData.filledFields);
                        console.error("  - Template writeOps:", templateWriteOps);

                        setMessages(prev => [...prev, {
                          role: "ai",
                          text: "❌ AI 결과와 템플릿 슬롯을 매칭할 수 없습니다.\n\n" +
                               "원인:\n" +
                               `• AI가 반환한 필드 (${fillData.filledFields.length}개)\n` +
                               `• 템플릿 슬롯 (${templateWriteOps.length}개)\n` +
                               `• 매칭된 항목: 0개\n\n` +
                               "콘솔 로그 (F12)를 확인하여 key가 일치하는지 확인하세요."
                        }]);
                        return;
                      }

                      // ops를 JSON Blob으로 변환 (curl -F "ops=@file.json"과 동일)
                      const opsBlob = new Blob([JSON.stringify(writeOps, null, 2)], {
                        type: 'application/json'
                      });
                      console.log("[자동채우기] ops Blob 생성:", {
                        size: opsBlob.size,
                        type: opsBlob.type,
                        filename: "write_ops.json"
                      });

                      const fillFormData = new FormData();
                      fillFormData.append("template", currentFileBlob, fileName);
                      fillFormData.append("ops", opsBlob, "write_ops.json");  // ✅ 파일로 전송 (curl과 동일)
                      fillFormData.append("skipEmpty", "1");

                      console.log("[자동채우기] FormData 필드:");
                      console.log("  - template:", fileName, `(${currentFileBlob.size} bytes)`);
                      console.log("  - ops: write_ops.json", `(${opsBlob.size} bytes, ${opsBlob.type})`);
                      console.log("  - skipEmpty: 1");

                      console.log("[자동채우기] POST /api/docx/fill-ops 호출...");
                      const filledResponse = await fetch("/api/docx/fill-ops", {
                        method: "POST",
                        body: fillFormData,
                        // Content-Type 헤더를 설정하지 않음 (브라우저가 boundary 자동 설정)
                      });

                      if (!filledResponse.ok) {
                        const errorText = await filledResponse.text();
                        console.error("[자동채우기] ❌ API 에러 발생");
                        console.error("[자동채우기] Status:", filledResponse.status, filledResponse.statusText);
                        console.error("[자동채우기] Response body:", errorText);

                        try {
                          const errorData = JSON.parse(errorText);
                          console.error("[자동채우기] Parsed error JSON:", errorData);
                          throw new Error(`DOCX 채우기 실패: ${errorData.error || errorData.details || filledResponse.statusText}`);
                        } catch (parseErr) {
                          console.error("[자동채우기] JSON 파싱 실패 (raw text):", errorText);
                          throw new Error(`DOCX 채우기 실패 (${filledResponse.status}): ${errorText}`);
                        }
                      }

                      // 성공 시 Summary 확인
                      console.log("[자동채우기] ✅ API 성공 (status 200)");
                      const summaryHeader = filledResponse.headers.get("X-Fill-Summary");
                      if (summaryHeader) {
                        console.log("[자동채우기] X-Fill-Summary:", summaryHeader);
                        const summary = JSON.parse(summaryHeader);
                        console.log(
                          `[자동채우기] 채우기 결과: ok=${summary.ok}, fail=${summary.fail}, ` +
                          `badPath=${summary.badPath}, noTable=${summary.noTable}, ` +
                          `noRow=${summary.noRow}, noCell=${summary.noCell}`
                        );

                        if (summary.ok === 11) {
                          console.log("[자동채우기] ✅ 성공 기준 충족: ok === 11");
                        } else {
                          console.warn(`[자동채우기] ⚠️ 예상과 다름: ok=${summary.ok} (기대: 11)`);
                        }
                      }

                      const filledBlob = await filledResponse.blob();
                      console.log("[자동채우기] 채워진 파일 크기:", filledBlob.size);

                      // 3.5. filled.docx 자동 다운로드
                      const downloadUrl = URL.createObjectURL(filledBlob);
                      const downloadLink = document.createElement('a');
                      downloadLink.href = downloadUrl;
                      downloadLink.download = `filled_${fileName}`;
                      document.body.appendChild(downloadLink);
                      downloadLink.click();
                      document.body.removeChild(downloadLink);
                      URL.revokeObjectURL(downloadUrl);
                      console.log("[자동채우기] ✅ filled.docx 자동 다운로드 완료");

                      // 4. 새 파일로 업로드 (OnlyOffice에서 보기 위함)
                      console.log("[자동채우기] 4단계: OnlyOffice에 업로드");
                      const uploadFormData = new FormData();
                      const newFileName = `filled_${Date.now()}_${fileName}`;
                      uploadFormData.append("file", filledBlob, newFileName);

                      const uploadResponse = await fetch("/api/onlyoffice/upload", {
                        method: "POST",
                        body: uploadFormData,
                      });

                      if (!uploadResponse.ok) {
                        throw new Error("파일 업로드 실패");
                      }

                      const uploadData = await uploadResponse.json();
                      console.log("[자동채우기] 업로드 완료:", uploadData);

                      // 5. OnlyOffice 문서 교체 (filled.docx로 리로드)
                      console.log("[자동채우기] 5단계: OnlyOffice 문서 교체");
                      console.log("[자동채우기] 이전 fileId:", onlyOfficeFileId);
                      console.log("[자동채우기] 새 fileId:", uploadData.fileId);
                      setOnlyOfficeFileId(uploadData.fileId);
                      setFileName(uploadData.fileName);
                      console.log("[자동채우기] ✅ OnlyOffice 문서 교체 완료 - 에디터가 리로드됩니다");

                      setMessages(prev => [...prev, {
                        role: "ai",
                        text: `✅ 자동 채우기 완료!\n\n📊 채우기 결과:\n- 성공: ${fillData.filledFields.length}개 항목\n- filled.docx 자동 다운로드 완료\n- OnlyOffice 문서가 업데이트되었습니다\n\n채워진 항목 (상위 ${Math.min(5, fillData.filledFields.length)}개):\n${fillData.filledFields.slice(0, 5).map((f: any) => `• ${f.label}: ${f.value.substring(0, 40)}${f.value.length > 40 ? '...' : ''}`).join('\n')}${fillData.filledFields.length > 5 ? `\n...외 ${fillData.filledFields.length - 5}개` : ''}`
                      }]);

                    } catch (error: any) {
                      console.error("[자동채우기] 에러:", error);
                      setMessages(prev => [...prev, {
                        role: "ai",
                        text: `자동 채우기 실패: ${error.message}\n\n콘솔 로그를 확인하세요 (F12 → Console)`
                      }]);
                    } finally {
                      setIsLoading(false);
                      setLoadingMessage(null);
                    }
                  }}
                  className={styles.aiInsertButton}
                  style={{ background: "linear-gradient(135deg, #10b981, #059669)" }}
                  disabled={isLoading || !sourceText}
                >
                  AI 자동 채우기
                </button>
                <button
                  onClick={() => {
                    const downloadUrl = `/api/onlyoffice/file/${onlyOfficeFileId}`;
                    const a = document.createElement("a");
                    a.href = downloadUrl;
                    a.download = fileName;
                    a.click();
                  }}
                  className={styles.primaryButton}
                >
                  DOCX 다운로드
                </button>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: "#666" }}>
                편집된 내용은 자동으로 저장됩니다.
              </div>
            </div>
          )}

          {/* 메시지 */}
          <div className={styles.messageList}>
            {messages.map((m, i) => (
              <div key={i} className={`${styles.messageItem} ${m.role === "user" ? styles.messageUser : styles.messageAi}`}>
                {m.text}
              </div>
            ))}
          </div>
        </div>

        {/* 채팅 입력 */}
        <form onSubmit={handleChatSubmit} className={styles.chatFormSticky}>
          <textarea
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="AI에게 요청하세요..."
            rows={3}
            className={styles.chatInput}
          />
          <button type="submit" className={styles.chatButton} disabled={isLoading}>
            요청 보내기
          </button>
        </form>
      </aside>

      <main className={styles.main}>
        <div className={styles.editorWrapper}>
          {/* OnlyOffice 뷰어 (실시간 편집) */}
          {fileType === "docx" && onlyOfficeFileId ? (
            <OnlyOfficeEditor
              key={onlyOfficeFileId}
              fileId={onlyOfficeFileId}
              fileName={fileName}
              onReady={() => {
                setMessages(prev => [...prev, {
                  role: "ai",
                  text: "OnlyOffice 편집기 로드 완료! Word처럼 문서를 편집할 수 있습니다."
                }]);
              }}
            />
          ) : null}

          {/* 플레이스홀더 */}
          {!fileType && !isLoading && (
            <div className={styles.placeholder}>
              DOCX 파일을 업로드해주세요
            </div>
          )}

          {/* 로딩 오버레이 */}
          {isLoading && (
            <div className={styles.overlay}>
              <div className={styles.overlayContent}>
                <div className={styles.overlayTitle}>{loadingMessage || "처리 중..."}</div>
                <div className={styles.overlaySubtitle}>잠시만 기다려 주세요.</div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// ========== 필드 오버레이 컴포넌트 ==========
interface FieldOverlayProps {
  field: FormField;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (value: string) => void;
  onDrag: (x: number, y: number) => void;
  onLabelChange: (label: string) => void;
}

function FieldOverlay({ field, isSelected, onSelect, onChange, onDrag, onLabelChange }: FieldOverlayProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") {
      return;
    }
    e.preventDefault();
    setIsDragging(true);
    const rect = ref.current?.getBoundingClientRect();
    if (rect) {
      setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
    onSelect();
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const parent = ref.current?.parentElement;
      if (!parent) return;
      const parentRect = parent.getBoundingClientRect();
      const newX = e.clientX - parentRect.left - dragOffset.x;
      const newY = e.clientY - parentRect.top - dragOffset.y;
      onDrag(Math.max(0, newX), Math.max(0, newY));
    };

    const handleMouseUp = () => setIsDragging(false);

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragOffset, onDrag]);

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        left: field.x,
        top: field.y,
        width: field.width,
        minHeight: field.height,
        background: "rgba(255,255,255,0.95)",
        border: isSelected ? "2px solid #3b82f6" : "1px solid #94a3b8",
        borderRadius: 6,
        boxShadow: isSelected ? "0 2px 8px rgba(59,130,246,0.3)" : "0 1px 3px rgba(0,0,0,0.1)",
        cursor: "move",
        overflow: "hidden"
      }}
      onMouseDown={handleMouseDown}
      onClick={onSelect}
    >
      <div style={{
        background: isSelected ? "#3b82f6" : "#64748b",
        color: "#fff",
        padding: "3px 8px",
        fontSize: 11,
        fontWeight: 600
      }}>
        {isSelected ? (
          <input
            value={field.label}
            onChange={(e) => onLabelChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "transparent",
              border: "none",
              color: "#fff",
              fontSize: 11,
              fontWeight: 600,
              width: "100%",
              outline: "none"
            }}
          />
        ) : field.label}
      </div>
      {field.type === "multiline" ? (
        <textarea
          value={field.value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          style={{
            width: "100%",
            minHeight: 50,
            border: "none",
            padding: "6px 8px",
            fontSize: 12,
            resize: "vertical",
            outline: "none"
          }}
        />
      ) : (
        <input
          type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
          value={field.value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          style={{
            width: "100%",
            border: "none",
            padding: "6px 8px",
            fontSize: 12,
            outline: "none"
          }}
        />
      )}
    </div>
  );
}
