"use client";

import React, { useCallback, useRef, useState } from "react";
import styles from "./form-editor.module.css";

interface FormField {
  id: string;
  label: string;
  type: "text" | "date" | "number" | "multiline" | "checkbox";
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
  value: string;
  placeholder?: string;
  context?: string;
}

interface PdfTextItem {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  page: number;
}

type ChatMsg = { role: "ai" | "user"; text: string };

export default function FormEditorPage() {
  // PDF 상태
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfBuffer, setPdfBuffer] = useState<ArrayBuffer | null>(null);
  const pdfDocRef = useRef<any>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // 페이지 상태
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  // 텍스트 아이템 (원본 PDF에서 추출)
  const [pdfTextItems, setPdfTextItems] = useState<PdfTextItem[]>([]);
  const [extractedText, setExtractedText] = useState("");

  // 양식 필드 (AI가 분석한 필드 + 사용자 추가 필드)
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [selectedField, setSelectedField] = useState<string | null>(null);

  // AI 분석 결과
  const [formType, setFormType] = useState<string>("");
  const [formSummary, setFormSummary] = useState<string>("");

  // 자료 텍스트
  const [sourceText, setSourceText] = useState("");

  // UI 상태
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: "ai", text: "PDF 양식을 업로드하세요. AI가 자동으로 분석하고 편집 가능한 필드를 찾아드립니다." }
  ]);

  // 필드 추가 모드
  const [isAddingField, setIsAddingField] = useState(false);
  const [newFieldStart, setNewFieldStart] = useState<{ x: number; y: number } | null>(null);

  // ========== PDF 렌더링 ==========
  const renderPage = useCallback(async (pageNum: number) => {
    if (!pdfDocRef.current || !canvasContainerRef.current) return;

    const page = await pdfDocRef.current.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    // 캔버스 생성/갱신
    let canvas = canvasContainerRef.current.querySelector("canvas");
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvasContainerRef.current.insertBefore(canvas, canvasContainerRef.current.firstChild);
    }

    const context = canvas.getContext("2d");
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    canvas.style.display = "block";

    setCanvasSize({ width: viewport.width, height: viewport.height });

    await page.render({ canvasContext: context, viewport }).promise;

    // 텍스트 추출
    const textContent = await page.getTextContent();
    const items = textContent.items.map((item: any, idx: number) => {
      const tx = item.transform;
      const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
      return {
        id: `txt-${pageNum}-${idx}`,
        text: item.str,
        x: tx[4] * scale,
        y: viewport.height - (tx[5] * scale) - (fontHeight * scale),
        width: item.width * scale,
        height: fontHeight * scale,
        fontSize: fontHeight * scale,
        page: pageNum,
      };
    }).filter((item: PdfTextItem) => item.text.trim());

    setPdfTextItems(items);
  }, [scale]);

  // ========== PDF 로드 ==========
  const loadPdf = useCallback(async (buffer: ArrayBuffer) => {
    setIsLoading(true);
    setLoadingMsg("PDF 로딩 중...");

    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

      const pdf = await pdfjs.getDocument({ data: buffer }).promise;
      pdfDocRef.current = pdf;
      setTotalPages(pdf.numPages);
      setCurrentPage(1);

      await renderPage(1);

      // 전체 텍스트 추출
      let fullText = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        fullText += content.items.map((item: any) => item.str).join(" ") + "\n";
      }
      setExtractedText(fullText.trim());

      setMessages(prev => [...prev, {
        role: "ai",
        text: `PDF 로드 완료! (${pdf.numPages}페이지)\n\n"AI 양식 분석" 버튼을 클릭하면 입력 필드를 자동으로 찾아드립니다.`
      }]);

    } catch (err) {
      console.error("PDF 로드 실패:", err);
      setMessages(prev => [...prev, { role: "ai", text: "PDF 로드에 실패했습니다." }]);
    } finally {
      setIsLoading(false);
      setLoadingMsg("");
    }
  }, [renderPage]);

  // 페이지/스케일 변경 시 다시 렌더링
  React.useEffect(() => {
    if (pdfDocRef.current && currentPage > 0) {
      renderPage(currentPage);
    }
  }, [currentPage, scale, renderPage]);

  // ========== 파일 업로드 ==========
  const handlePdfUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPdfFile(file);
    const buffer = await file.arrayBuffer();
    setPdfBuffer(buffer);
    await loadPdf(buffer);

    // 초기화
    setFormFields([]);
    setFormType("");
    setFormSummary("");
    setSourceText("");

    e.target.value = "";
  }, [loadPdf]);

  // ========== AI 양식 분석 ==========
  const analyzeForm = useCallback(async () => {
    if (!extractedText) {
      setMessages(prev => [...prev, { role: "ai", text: "먼저 PDF를 업로드해주세요." }]);
      return;
    }

    setIsLoading(true);
    setLoadingMsg("AI가 양식을 분석 중...");

    try {
      const res = await fetch("/api/analyze-form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "analyze",
          formText: extractedText
        })
      });

      const data = await res.json();

      if (data.fields && data.fields.length > 0) {
        // AI가 찾은 필드들을 FormField로 변환
        const newFields: FormField[] = data.fields.map((f: any, idx: number) => ({
          id: `field-${Date.now()}-${idx}`,
          label: f.label,
          type: f.type || "text",
          x: 50,
          y: 100 + idx * 60,
          width: 300,
          height: f.type === "multiline" ? 100 : 30,
          page: 1,
          value: "",
          placeholder: f.placeholder || "",
          context: f.context || ""
        }));

        setFormFields(newFields);
        setFormType(data.formType || "");
        setFormSummary(data.summary || "");

        setMessages(prev => [...prev, {
          role: "ai",
          text: `양식 분석 완료!\n\n📄 양식 종류: ${data.formType || "알 수 없음"}\n📝 ${data.summary || ""}\n\n🔍 발견된 필드 ${newFields.length}개:\n${newFields.map(f => `• ${f.label}`).join("\n")}\n\n오른쪽 패널에서 필드 위치를 드래그하여 조정하고, 내용을 입력하세요.`
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: "ai",
          text: "입력 필드를 찾지 못했습니다. '필드 추가' 버튼으로 직접 추가하세요."
        }]);
      }

    } catch (err) {
      console.error("양식 분석 실패:", err);
      setMessages(prev => [...prev, { role: "ai", text: "양식 분석에 실패했습니다." }]);
    } finally {
      setIsLoading(false);
      setLoadingMsg("");
    }
  }, [extractedText]);

  // ========== 자료 업로드 & 자동 채우기 ==========
  const handleSourceUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setLoadingMsg("자료 분석 중...");

    try {
      const buffer = await file.arrayBuffer();
      const ext = file.name.toLowerCase().split('.').pop();
      let text = "";

      if (ext === "pdf") {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
        const pdf = await pdfjs.getDocument({ data: buffer }).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          text += content.items.map((item: any) => item.str).join(" ") + "\n";
        }
      } else if (ext === "docx") {
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ arrayBuffer: buffer });
        text = result.value;
      } else if (ext === "txt") {
        text = new TextDecoder().decode(buffer);
      }

      setSourceText(text.trim());
      setMessages(prev => [...prev, {
        role: "ai",
        text: `자료 업로드 완료! (${text.length}자)\n\n"자동 채우기" 버튼을 클릭하면 AI가 양식을 자동으로 작성합니다.`
      }]);

    } catch (err) {
      console.error("자료 분석 실패:", err);
      setMessages(prev => [...prev, { role: "ai", text: "자료 분석에 실패했습니다." }]);
    } finally {
      setIsLoading(false);
      setLoadingMsg("");
      e.target.value = "";
    }
  }, []);

  // ========== AI 자동 채우기 ==========
  const autoFillForm = useCallback(async () => {
    if (!extractedText || !sourceText) {
      setMessages(prev => [...prev, {
        role: "ai",
        text: "양식과 자료 모두 필요합니다. 먼저 PDF 양식과 참고 자료를 업로드해주세요."
      }]);
      return;
    }

    if (formFields.length === 0) {
      setMessages(prev => [...prev, {
        role: "ai",
        text: "먼저 'AI 양식 분석'을 실행하거나 필드를 추가해주세요."
      }]);
      return;
    }

    setIsLoading(true);
    setLoadingMsg("AI가 내용을 작성 중...");

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

        setMessages(prev => [...prev, {
          role: "ai",
          text: `자동 채우기 완료!\n\n${data.filledFields.length}개 필드가 채워졌습니다.\n${data.suggestions ? `\n💡 ${data.suggestions}` : ""}\n\n각 필드를 클릭하여 내용을 확인/수정하세요.`
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: "ai",
          text: "자동 채우기에 실패했습니다. 자료에서 관련 정보를 찾지 못했습니다."
        }]);
      }

    } catch (err) {
      console.error("자동 채우기 실패:", err);
      setMessages(prev => [...prev, { role: "ai", text: "자동 채우기에 실패했습니다." }]);
    } finally {
      setIsLoading(false);
      setLoadingMsg("");
    }
  }, [extractedText, sourceText, formFields]);

  // ========== 필드 관리 ==========
  const handleFieldChange = useCallback((id: string, value: string) => {
    setFormFields(prev => prev.map(f => f.id === id ? { ...f, value } : f));
  }, []);

  const handleFieldDrag = useCallback((id: string, x: number, y: number) => {
    setFormFields(prev => prev.map(f => f.id === id ? { ...f, x, y } : f));
  }, []);

  const handleFieldResize = useCallback((id: string, width: number, height: number) => {
    setFormFields(prev => prev.map(f => f.id === id ? { ...f, width, height } : f));
  }, []);

  const addNewField = useCallback(() => {
    const newField: FormField = {
      id: `field-${Date.now()}`,
      label: `필드 ${formFields.length + 1}`,
      type: "text",
      x: 100,
      y: 100 + formFields.length * 50,
      width: 200,
      height: 30,
      page: currentPage,
      value: "",
      placeholder: "내용을 입력하세요"
    };
    setFormFields(prev => [...prev, newField]);
    setSelectedField(newField.id);
  }, [formFields.length, currentPage]);

  const deleteField = useCallback((id: string) => {
    setFormFields(prev => prev.filter(f => f.id !== id));
    if (selectedField === id) setSelectedField(null);
  }, [selectedField]);

  // ========== PDF 저장 ==========
  const savePdf = useCallback(async () => {
    if (!pdfBuffer) {
      setMessages(prev => [...prev, { role: "ai", text: "저장할 PDF가 없습니다." }]);
      return;
    }

    setIsLoading(true);
    setLoadingMsg("PDF 저장 중...");

    try {
      const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");
      const fontkit = await import("@pdf-lib/fontkit");

      const pdfDoc = await PDFDocument.load(pdfBuffer);
      pdfDoc.registerFontkit(fontkit.default);

      // 한글 폰트 로드 시도 (없으면 기본 폰트 사용)
      let font;
      try {
        const fontUrl = "/fonts/NanumGothic.ttf";
        const fontRes = await fetch(fontUrl);
        if (fontRes.ok) {
          const fontBytes = await fontRes.arrayBuffer();
          font = await pdfDoc.embedFont(fontBytes);
        } else {
          font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        }
      } catch {
        font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      }

      const pages = pdfDoc.getPages();

      // 각 필드를 PDF에 추가
      for (const field of formFields) {
        if (!field.value || field.page > pages.length) continue;

        const page = pages[field.page - 1];
        const { height } = page.getSize();

        // 스케일 보정 (화면 좌표 → PDF 좌표)
        const pdfX = field.x / scale;
        const pdfY = height - (field.y / scale) - (field.height / scale);

        page.drawText(field.value, {
          x: pdfX,
          y: pdfY,
          size: 12,
          font,
          color: rgb(0, 0, 0),
        });
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = pdfFile?.name?.replace(".pdf", "_filled.pdf") || "filled_form.pdf";
      a.click();
      URL.revokeObjectURL(url);

      setMessages(prev => [...prev, {
        role: "ai",
        text: "PDF 저장 완료! 다운로드가 시작됩니다."
      }]);

    } catch (err) {
      console.error("PDF 저장 실패:", err);
      setMessages(prev => [...prev, { role: "ai", text: "PDF 저장에 실패했습니다." }]);
    } finally {
      setIsLoading(false);
      setLoadingMsg("");
    }
  }, [pdfBuffer, pdfFile, formFields, scale]);

  // ========== 네비게이션 ==========
  const goToPrevPage = () => currentPage > 1 && setCurrentPage(currentPage - 1);
  const goToNextPage = () => currentPage < totalPages && setCurrentPage(currentPage + 1);
  const zoomIn = () => setScale(s => Math.min(s + 0.25, 3));
  const zoomOut = () => setScale(s => Math.max(s - 0.25, 0.5));

  // ========== 렌더링 ==========
  return (
    <div className={styles.container}>
      {/* 왼쪽 사이드바 */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <h2>PDF 양식 편집기</h2>
          <p className={styles.subtitle}>Docker 불필요 - 100% 브라우저 기반</p>
        </div>

        <div className={styles.sidebarContent}>
          {/* 파일 업로드 */}
          <section className={styles.section}>
            <h3>1. 양식 업로드</h3>
            <label className={styles.uploadBtn}>
              PDF 양식 선택
              <input type="file" accept=".pdf" hidden onChange={handlePdfUpload} />
            </label>
            {pdfFile && <span className={styles.fileName}>{pdfFile.name}</span>}
          </section>

          {/* AI 분석 */}
          <section className={styles.section}>
            <h3>2. AI 양식 분석</h3>
            <button
              onClick={analyzeForm}
              disabled={!extractedText || isLoading}
              className={styles.actionBtn}
            >
              AI 양식 분석
            </button>
            {formType && (
              <div className={styles.formInfo}>
                <strong>{formType}</strong>
                <p>{formSummary}</p>
              </div>
            )}
          </section>

          {/* 자료 업로드 */}
          <section className={styles.section}>
            <h3>3. 참고 자료 업로드</h3>
            <label className={styles.uploadBtn}>
              자료 선택 (PDF/DOCX/TXT)
              <input type="file" accept=".pdf,.docx,.txt" hidden onChange={handleSourceUpload} />
            </label>
            {sourceText && <span className={styles.fileName}>{sourceText.length}자 로드됨</span>}
          </section>

          {/* 자동 채우기 */}
          <section className={styles.section}>
            <h3>4. 자동 채우기</h3>
            <button
              onClick={autoFillForm}
              disabled={!sourceText || formFields.length === 0 || isLoading}
              className={styles.actionBtn}
            >
              AI 자동 채우기
            </button>
          </section>

          {/* 필드 관리 */}
          <section className={styles.section}>
            <h3>필드 관리</h3>
            <button onClick={addNewField} className={styles.addFieldBtn}>
              + 필드 추가
            </button>
            <div className={styles.fieldList}>
              {formFields.filter(f => f.page === currentPage).map(field => (
                <div
                  key={field.id}
                  className={`${styles.fieldItem} ${selectedField === field.id ? styles.fieldItemSelected : ""}`}
                  onClick={() => setSelectedField(field.id)}
                >
                  <span>{field.label}</span>
                  <button onClick={(e) => { e.stopPropagation(); deleteField(field.id); }}>×</button>
                </div>
              ))}
            </div>
          </section>

          {/* 저장 */}
          <section className={styles.section}>
            <button
              onClick={savePdf}
              disabled={!pdfBuffer || isLoading}
              className={styles.saveBtn}
            >
              PDF 저장
            </button>
          </section>
        </div>

        {/* 메시지 */}
        <div className={styles.messages}>
          {messages.map((msg, i) => (
            <div key={i} className={`${styles.message} ${styles[msg.role]}`}>
              {msg.text}
            </div>
          ))}
        </div>

        {isLoading && <div className={styles.loadingOverlay}>{loadingMsg}</div>}
      </aside>

      {/* 메인 뷰어 */}
      <main className={styles.main}>
        {pdfBuffer ? (
          <>
            {/* 컨트롤 바 */}
            <div className={styles.controls}>
              <div className={styles.pageNav}>
                <button onClick={goToPrevPage} disabled={currentPage <= 1}>◀</button>
                <span>{currentPage} / {totalPages}</span>
                <button onClick={goToNextPage} disabled={currentPage >= totalPages}>▶</button>
              </div>
              <div className={styles.zoomNav}>
                <button onClick={zoomOut}>−</button>
                <span>{Math.round(scale * 100)}%</span>
                <button onClick={zoomIn}>+</button>
              </div>
            </div>

            {/* PDF 캔버스 + 오버레이 */}
            <div className={styles.canvasWrapper}>
              <div
                ref={canvasContainerRef}
                className={styles.canvasContainer}
                style={{ width: canvasSize.width, height: canvasSize.height }}
              >
                {/* 편집 필드 오버레이 */}
                {formFields.filter(f => f.page === currentPage).map(field => (
                  <FieldOverlay
                    key={field.id}
                    field={field}
                    isSelected={selectedField === field.id}
                    onSelect={() => setSelectedField(field.id)}
                    onChange={(val) => handleFieldChange(field.id, val)}
                    onDrag={(x, y) => handleFieldDrag(field.id, x, y)}
                    onResize={(w, h) => handleFieldResize(field.id, w, h)}
                  />
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className={styles.placeholder}>
            <div className={styles.placeholderIcon}>📄</div>
            <h3>PDF 양식을 업로드하세요</h3>
            <p>원본 100% 표시 + AI 양식 분석 + 실시간 편집</p>
          </div>
        )}
      </main>

      {/* 선택된 필드 편집 패널 */}
      {selectedField && (
        <aside className={styles.propertyPanel}>
          <h3>필드 편집</h3>
          {(() => {
            const field = formFields.find(f => f.id === selectedField);
            if (!field) return null;
            return (
              <>
                <div className={styles.propGroup}>
                  <label>필드명</label>
                  <input
                    value={field.label}
                    onChange={(e) => setFormFields(prev =>
                      prev.map(f => f.id === selectedField ? { ...f, label: e.target.value } : f)
                    )}
                  />
                </div>
                <div className={styles.propGroup}>
                  <label>내용</label>
                  {field.type === "multiline" ? (
                    <textarea
                      value={field.value}
                      onChange={(e) => handleFieldChange(field.id, e.target.value)}
                      rows={5}
                    />
                  ) : (
                    <input
                      value={field.value}
                      onChange={(e) => handleFieldChange(field.id, e.target.value)}
                      placeholder={field.placeholder}
                    />
                  )}
                </div>
                <div className={styles.propGroup}>
                  <label>타입</label>
                  <select
                    value={field.type}
                    onChange={(e) => setFormFields(prev =>
                      prev.map(f => f.id === selectedField ? { ...f, type: e.target.value as any } : f)
                    )}
                  >
                    <option value="text">텍스트</option>
                    <option value="multiline">여러 줄</option>
                    <option value="date">날짜</option>
                    <option value="number">숫자</option>
                  </select>
                </div>
                <div className={styles.propGroup}>
                  <label>크기</label>
                  <div className={styles.sizeInputs}>
                    <input
                      type="number"
                      value={Math.round(field.width)}
                      onChange={(e) => handleFieldResize(field.id, Number(e.target.value), field.height)}
                    />
                    <span>×</span>
                    <input
                      type="number"
                      value={Math.round(field.height)}
                      onChange={(e) => handleFieldResize(field.id, field.width, Number(e.target.value))}
                    />
                  </div>
                </div>
                <button onClick={() => setSelectedField(null)} className={styles.closeBtn}>
                  닫기
                </button>
              </>
            );
          })()}
        </aside>
      )}
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
  onResize: (width: number, height: number) => void;
}

function FieldOverlay({ field, isSelected, onSelect, onChange, onDrag, onResize }: FieldOverlayProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") {
      return;
    }
    e.preventDefault();
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - field.x,
      y: e.clientY - field.y
    });
    onSelect();
  };

  React.useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const parentRect = ref.current?.parentElement?.getBoundingClientRect();
      if (!parentRect) return;

      const newX = Math.max(0, Math.min(e.clientX - dragOffset.x, parentRect.width - field.width));
      const newY = Math.max(0, Math.min(e.clientY - dragOffset.y, parentRect.height - field.height));
      onDrag(newX, newY);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragOffset, field.width, field.height, onDrag]);

  return (
    <div
      ref={ref}
      className={`${styles.fieldOverlay} ${isSelected ? styles.fieldOverlaySelected : ""}`}
      style={{
        left: field.x,
        top: field.y,
        width: field.width,
        height: field.height,
      }}
      onMouseDown={handleMouseDown}
      onClick={onSelect}
    >
      <div className={styles.fieldLabel}>{field.label}</div>
      {field.type === "multiline" ? (
        <textarea
          className={styles.fieldInput}
          value={field.value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
        />
      ) : (
        <input
          type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
          className={styles.fieldInput}
          value={field.value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
        />
      )}
      {isSelected && (
        <div
          className={styles.resizeHandle}
          onMouseDown={(e) => {
            e.stopPropagation();
            const startX = e.clientX;
            const startY = e.clientY;
            const startW = field.width;
            const startH = field.height;

            const handleMove = (me: MouseEvent) => {
              onResize(
                Math.max(100, startW + (me.clientX - startX)),
                Math.max(25, startH + (me.clientY - startY))
              );
            };

            const handleUp = () => {
              window.removeEventListener("mousemove", handleMove);
              window.removeEventListener("mouseup", handleUp);
            };

            window.addEventListener("mousemove", handleMove);
            window.addEventListener("mouseup", handleUp);
          }}
        />
      )}
    </div>
  );
}
