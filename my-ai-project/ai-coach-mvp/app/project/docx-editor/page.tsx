"use client";

import React, { useCallback, useRef, useState } from "react";
import styles from "./docx-editor.module.css";

interface FormField {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  context?: string;
}

type ChatMsg = { role: "ai" | "user"; text: string };

export default function DocxEditorPage() {
  // DOCX 파일 상태
  const [docxFile, setDocxFile] = useState<File | null>(null);
  const [docxBuffer, setDocxBuffer] = useState<ArrayBuffer | null>(null);
  const docxContainerRef = useRef<HTMLDivElement>(null);

  // 추출된 텍스트 및 구조
  const [extractedText, setExtractedText] = useState("");
  const [docxHtml, setDocxHtml] = useState("");

  // 양식 필드 (AI가 분석)
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [formType, setFormType] = useState<string>("");
  const [formSummary, setFormSummary] = useState<string>("");

  // 참고 자료
  const [sourceText, setSourceText] = useState("");

  // UI 상태
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: "ai", text: "DOCX 양식을 업로드하세요. AI가 자동으로 분석하고 내용을 채워드립니다." }
  ]);

  // ========== DOCX 로드 & 렌더링 ==========
  const loadDocx = useCallback(async (buffer: ArrayBuffer) => {
    setIsLoading(true);
    setLoadingMsg("DOCX 로딩 중...");

    try {
      // mammoth로 HTML 변환 (100% 레이아웃 유지)
      const mammoth = await import("mammoth");
      const result = await mammoth.convertToHtml(
        { arrayBuffer: buffer },
        {
          styleMap: [
            "p[style-name='Heading 1'] => h1:fresh",
            "p[style-name='Heading 2'] => h2:fresh",
            "p[style-name='Title'] => h1.title:fresh"
          ]
        }
      );

      setDocxHtml(result.value);

      // 텍스트 추출
      const textResult = await mammoth.extractRawText({ arrayBuffer: buffer });
      setExtractedText(textResult.value);

      setMessages(prev => [...prev, {
        role: "ai",
        text: `DOCX 로드 완료! (${textResult.value.length}자)\n\n"AI 양식 분석" 버튼을 클릭하면 입력 필드를 자동으로 찾아드립니다.`
      }]);

    } catch (err) {
      console.error("DOCX 로드 실패:", err);
      setMessages(prev => [...prev, { role: "ai", text: "DOCX 로드에 실패했습니다." }]);
    } finally {
      setIsLoading(false);
      setLoadingMsg("");
    }
  }, []);

  // ========== 파일 업로드 ==========
  const handleDocxUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.docx')) {
      alert('DOCX 파일만 업로드 가능합니다.');
      return;
    }

    setDocxFile(file);
    const buffer = await file.arrayBuffer();
    setDocxBuffer(buffer);
    await loadDocx(buffer);

    // 초기화
    setFormFields([]);
    setFormType("");
    setFormSummary("");
    setSourceText("");

    e.target.value = "";
  }, [loadDocx]);

  // ========== AI 양식 분석 ==========
  const analyzeForm = useCallback(async () => {
    if (!extractedText) {
      setMessages(prev => [...prev, { role: "ai", text: "먼저 DOCX를 업로드해주세요." }]);
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
        const newFields: FormField[] = data.fields.map((f: any, idx: number) => ({
          id: `field-${Date.now()}-${idx}`,
          label: f.label,
          value: "",
          placeholder: f.placeholder || "",
          context: f.context || ""
        }));

        setFormFields(newFields);
        setFormType(data.formType || "");
        setFormSummary(data.summary || "");

        setMessages(prev => [...prev, {
          role: "ai",
          text: `양식 분석 완료!\n\n📄 양식 종류: ${data.formType || "알 수 없음"}\n📝 ${data.summary || ""}\n\n🔍 발견된 필드 ${newFields.length}개:\n${newFields.map(f => `• ${f.label}`).join("\n")}\n\n이제 참고 자료를 업로드하면 AI가 자동으로 내용을 채워드립니다.`
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: "ai",
          text: "입력 필드를 찾지 못했습니다. 양식이 비어있거나 형식이 다를 수 있습니다."
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

  // ========== 참고 자료 업로드 ==========
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
        text: "양식과 자료 모두 필요합니다. 먼저 DOCX 양식과 참고 자료를 업로드해주세요."
      }]);
      return;
    }

    if (formFields.length === 0) {
      setMessages(prev => [...prev, {
        role: "ai",
        text: "먼저 'AI 양식 분석'을 실행해주세요."
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

        // HTML에 값 채우기 (실시간 반영)
        updateDocxHtml(data.filledFields);

        setMessages(prev => [...prev, {
          role: "ai",
          text: `자동 채우기 완료!\n\n${data.filledFields.length}개 필드가 채워졌습니다.\n${data.suggestions ? `\n💡 ${data.suggestions}` : ""}\n\n오른쪽 패널에서 각 필드를 확인하고 수정할 수 있습니다.`
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

  // ========== HTML 업데이트 (필드 값 반영) ==========
  const updateDocxHtml = useCallback((filledFields: any[]) => {
    let updatedHtml = docxHtml;

    filledFields.forEach(field => {
      // 빈칸 패턴 찾기 및 교체
      const patterns = [
        new RegExp(`___+`, 'g'),
        new RegExp(`\\[\\s*\\]`, 'g'),
        new RegExp(`\\(\\s*\\)`, 'g'),
        new RegExp(`${field.label}\\s*:?\\s*`, 'gi')
      ];

      patterns.forEach(pattern => {
        updatedHtml = updatedHtml.replace(pattern, `<strong>${field.value}</strong>`);
      });
    });

    setDocxHtml(updatedHtml);
  }, [docxHtml]);

  // ========== 필드 수동 수정 ==========
  const handleFieldChange = useCallback((id: string, value: string) => {
    setFormFields(prev => prev.map(f => f.id === id ? { ...f, value } : f));

    // HTML도 실시간 업데이트
    const field = formFields.find(f => f.id === id);
    if (field) {
      updateDocxHtml([{ label: field.label, value }]);
    }
  }, [formFields, updateDocxHtml]);

  // ========== DOCX 저장 ==========
  const saveDocx = useCallback(async () => {
    if (!docxBuffer) {
      setMessages(prev => [...prev, { role: "ai", text: "저장할 DOCX가 없습니다." }]);
      return;
    }

    setIsLoading(true);
    setLoadingMsg("DOCX 저장 중...");

    try {
      const PizZip = (await import("pizzip")).default;
      const Docxtemplater = (await import("docxtemplater")).default;

      const zip = new PizZip(docxBuffer);
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
      });

      // 필드 값을 객체로 변환
      const data: Record<string, string> = {};
      formFields.forEach(field => {
        // 필드명을 키로, 값을 value로
        const key = field.label.replace(/[:\s]/g, '_');
        data[key] = field.value || '';
      });

      doc.render(data);

      const blob = doc.getZip().generate({
        type: "blob",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = docxFile?.name?.replace(".docx", "_filled.docx") || "filled_form.docx";
      a.click();
      URL.revokeObjectURL(url);

      setMessages(prev => [...prev, {
        role: "ai",
        text: "DOCX 저장 완료! 다운로드가 시작됩니다."
      }]);

    } catch (err) {
      console.error("DOCX 저장 실패:", err);
      setMessages(prev => [...prev, { role: "ai", text: "DOCX 저장에 실패했습니다." }]);
    } finally {
      setIsLoading(false);
      setLoadingMsg("");
    }
  }, [docxBuffer, docxFile, formFields]);

  // ========== 렌더링 ==========
  return (
    <div className={styles.container}>
      {/* 왼쪽 사이드바 */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <h2>DOCX 양식 편집기</h2>
          <p className={styles.subtitle}>AI 자동 작성 + 실시간 편집</p>
        </div>

        <div className={styles.sidebarContent}>
          {/* 1. 양식 업로드 */}
          <section className={styles.section}>
            <h3>1. 양식 업로드</h3>
            <label className={styles.uploadBtn}>
              DOCX 양식 선택
              <input type="file" accept=".docx" hidden onChange={handleDocxUpload} />
            </label>
            {docxFile && <span className={styles.fileName}>{docxFile.name}</span>}
          </section>

          {/* 2. AI 분석 */}
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

          {/* 3. 참고 자료 업로드 */}
          <section className={styles.section}>
            <h3>3. 참고 자료 업로드</h3>
            <label className={styles.uploadBtn}>
              자료 선택 (PDF/DOCX/TXT)
              <input type="file" accept=".pdf,.docx,.txt" hidden onChange={handleSourceUpload} />
            </label>
            {sourceText && <span className={styles.fileName}>{sourceText.length}자 로드됨</span>}
          </section>

          {/* 4. 자동 채우기 */}
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

          {/* 5. 저장 */}
          <section className={styles.section}>
            <button
              onClick={saveDocx}
              disabled={!docxBuffer || isLoading}
              className={styles.saveBtn}
            >
              DOCX 저장
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

      {/* 메인 뷰어 (DOCX HTML 렌더링) */}
      <main className={styles.main}>
        {docxHtml ? (
          <div className={styles.docxWrapper}>
            <div
              ref={docxContainerRef}
              className={styles.docxContent}
              dangerouslySetInnerHTML={{ __html: docxHtml }}
            />
          </div>
        ) : (
          <div className={styles.placeholder}>
            <div className={styles.placeholderIcon}>📄</div>
            <h3>DOCX 양식을 업로드하세요</h3>
            <p>100% 정확한 레이아웃 + AI 자동 작성 + 실시간 편집</p>
          </div>
        )}
      </main>

      {/* 오른쪽 패널 (필드 편집) */}
      <aside className={styles.fieldPanel}>
        <h3>필드 편집</h3>
        {formFields.length > 0 ? (
          <div className={styles.fieldList}>
            {formFields.map(field => (
              <div key={field.id} className={styles.fieldItem}>
                <label>{field.label}</label>
                <textarea
                  value={field.value}
                  onChange={(e) => handleFieldChange(field.id, e.target.value)}
                  placeholder={field.placeholder}
                  rows={3}
                />
                {field.context && (
                  <small className={styles.fieldContext}>💡 {field.context}</small>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.emptyFields}>
            양식을 분석하면 여기에 입력 필드가 표시됩니다.
          </p>
        )}
      </aside>
    </div>
  );
}
