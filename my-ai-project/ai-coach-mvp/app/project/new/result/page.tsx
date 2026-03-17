"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { registerUploadedFile } from "@/lib/fileRegistry";
import { saveTemplateToIDB, getTemplateFromIDB } from "@/lib/templateStore";
import { saveWorkspace, getWorkspace } from "@/lib/workspaceStore";
import styles from "./result.module.css";

/* ─── types ─── */

type TemplateType = "레포트" | "실험보고서" | "논문" | "강의노트" | "문헌고찰";
type ChatMsg = { role: "ai" | "user"; text: string };

/* ─── 타입별 기본 DOCX 매핑 ─── */

const TYPE_TO_DEFAULT_DOCX: Record<TemplateType, string> = {
  "레포트": "/templates/report.docx",
  "실험보고서": "/templates/lab_report.docx",
  "논문": "/templates/thesis.docx",
  "강의노트": "/templates/lecture_note.docx",
  "문헌고찰": "/templates/review.docx",
};

interface SlotInfo {
  key: string;
  kind: string;
  label: string;
  currentText: string;
  xmlPath: string;
  structural?: boolean;
}

interface UploadResult {
  fileId: string;
  fileName: string;
  storageKey: string;
  accessToken: string;
  url: string;
}

/* ─── dynamic imports (컴포넌트 바깥) ─── */

const OnlyOfficeEditor = dynamic(
  () => import("@/components/OnlyOfficeEditor"),
  { ssr: false }
);

const Workspace = dynamic(() => Promise.resolve(WorkspaceImpl), { ssr: false });

export default function ResultPage() {
  return (
    <Suspense fallback={<div style={{ padding: 20 }}>로딩 중...</div>}>
      <Workspace />
    </Suspense>
  );
}

/* ─── 서버에 DOCX 업로드 (OnlyOffice가 URL로 접근) ─── */

async function uploadDocxToServer(
  buffer: ArrayBuffer,
  name: string
): Promise<UploadResult> {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const form = new FormData();
  form.append("file", blob, name);
  const res = await fetch("/api/onlyoffice/upload", {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error("서버 업로드 실패");
  const upload = (await res.json()) as UploadResult;
  void registerUploadedFile({
    fileId: upload.fileId,
    fileName: upload.fileName,
    storageKey: upload.storageKey,
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    byteSize: buffer.byteLength,
  });
  return upload;
}

/* ─── main workspace ─── */

function WorkspaceImpl() {
  const router = useRouter();
  const sp = useSearchParams();

  const type = (sp.get("type") || "레포트") as TemplateType;
  const templateIdFromUrl = sp.get("templateId") || "";
  const workspaceIdFromUrl = sp.get("workspaceId") || "";

  const [activeTemplateId, setActiveTemplateId] = useState(templateIdFromUrl);
  useEffect(() => setActiveTemplateId(templateIdFromUrl), [templateIdFromUrl]);

  const [workspaceId, setWorkspaceId] = useState(workspaceIdFromUrl);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [templateFileId, setTemplateFileId] = useState("");
  const [filledFileId, setFilledFileId] = useState("");

  // DOCX states
  const [docxBuffer, setDocxBuffer] = useState<ArrayBuffer | null>(null);
  const [slots, setSlots] = useState<SlotInfo[]>([]);
  const [sourceFiles, setSourceFiles] = useState<Array<{ name: string; text: string }>>([]);
  const [lastResults, setLastResults] = useState<{ key: string; value: string }[]>([]);
  const lastSourceTextRef = useRef(""); // 마지막 자료 텍스트 보관 (채팅 수정 시 재사용)

  // OnlyOffice 상태
  const [editorFileUrl, setEditorFileUrl] = useState("");
  const [editorFileId, setEditorFileId] = useState("");
  const [editorAccessToken, setEditorAccessToken] = useState("");
  const [editorFileName, setEditorFileName] = useState("");
  const [editorKey, setEditorKey] = useState("");

  // UI states
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: "ai", text: `'${type}' 양식을 준비하고 있습니다...` },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [selectedSlotKeys, setSelectedSlotKeys] = useState<Set<string>>(new Set());
  const [slotPanelOpen, setSlotPanelOpen] = useState(false);
  const [slotSearch, setSlotSearch] = useState("");
  const [editingSlotKey, setEditingSlotKey] = useState<string | null>(null);
  const [editingSlotValue, setEditingSlotValue] = useState("");
  const loadedKeyRef = useRef<string>("");
  const autoLoadedRef = useRef(false);

  /* ─── 템플릿 로드 + 서버 업로드 + 슬롯 분석 ─── */

  const loadTemplate = useCallback(
    async (buffer: ArrayBuffer, fileName: string) => {
      setDocxBuffer(buffer);
      setSlots([]);

      // 1) 서버에 업로드 (OnlyOffice가 URL로 접근)
      setLoadingMessage("서버에 업로드 중...");
      const upload = await uploadDocxToServer(buffer, fileName);
      setEditorFileUrl(upload.url);
      setEditorFileId(upload.fileId);
      setEditorAccessToken(upload.accessToken);
      setEditorFileName(upload.fileName);
      setEditorKey(`${upload.fileId}_${Date.now()}`);
      setTemplateFileId(upload.fileId);
      setFilledFileId("");

      // 2) 슬롯 분석
      setLoadingMessage("슬롯 스캔 중...");
      try {
        const blob = new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
        const form = new FormData();
        form.append("file", blob, "template.docx");

        const res = await fetch("/api/docs/analyze", {
          method: "POST",
          body: form,
        });

        if (res.ok) {
          const data = await res.json();
          const scanned = (data.slots || []) as SlotInfo[];
          setSlots(scanned);

          let analysisMsg = `템플릿 분석 완료: ${scanned.length}개 슬롯 감지 (BODY: ${data.debug?.bodySections ?? 0}, TEXTBOX: ${data.debug?.textboxes ?? 0}, TABLE: ${data.debug?.tables ?? 0})`;

          // 0개 슬롯인데 문서에 콘텐츠가 있으면 진단 정보 표시
          if (scanned.length === 0 && data.debug?.diagnostics) {
            const d = data.debug.diagnostics;
            analysisMsg += `\n\n⚠️ 문서에 단락 ${d.totalParagraphs}개, 테이블 ${d.totalTables}개, SDT ${d.totalSdts}개가 있지만 슬롯으로 감지되지 않았습니다. 양식 구조가 지원되지 않는 형식일 수 있습니다.`;
          }

          setMessages((prev) => [
            ...prev,
            { role: "ai", text: analysisMsg },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            { role: "ai", text: "슬롯 분석 실패. 수동 채움만 가능합니다." },
          ]);
        }
      } catch (err) {
        console.warn("슬롯 분석 에러:", err);
      }
    },
    []
  );

  // computed: 모든 소스 파일 텍스트 합침
  const combinedSourceText = sourceFiles.map((f) => f.text).join("\n\n---\n\n");

  /* ─── 기본 템플릿 자동 로드 ─── */

  useEffect(() => {
    if (autoLoadedRef.current) return;
    if (templateIdFromUrl) return; // 이미 특정 templateId가 있으면 스킵
    if (workspaceIdFromUrl) return; // 워크스페이스 복원 시 스킵

    const docxPath = TYPE_TO_DEFAULT_DOCX[type];
    if (!docxPath) return;

    autoLoadedRef.current = true;

    (async () => {
      setIsLoading(true);
      setLoadingMessage("기본 양식 불러오는 중...");
      try {
        const res = await fetch(docxPath);
        if (!res.ok) throw new Error(`기본 양식 다운로드 실패: ${res.status}`);
        const buf = await res.arrayBuffer();
        await loadTemplate(buf, docxPath.split("/").pop() || "template.docx");
        setMessages((prev) => [
          ...prev,
          { role: "ai", text: `'${type}' 기본 양식이 로드되었습니다. 자료를 추가하고 AI 자동 채우기를 실행하세요.` },
        ]);
      } catch (err) {
        console.error("기본 양식 자동 로드 실패:", err);
        setMessages((prev) => [
          ...prev,
          { role: "ai", text: "기본 양식 로드 실패. 직접 DOCX를 업로드해주세요." },
        ]);
      } finally {
        setIsLoading(false);
        setLoadingMessage(null);
      }
    })();
  }, [type, templateIdFromUrl, loadTemplate]);

  /* ─── templateId로 IndexedDB에서 템플릿 로드 ─── */
  useEffect(() => {
    if (!templateIdFromUrl || workspaceIdFromUrl) return;
    if (autoLoadedRef.current) return;
    autoLoadedRef.current = true;

    (async () => {
      setIsLoading(true);
      setLoadingMessage("업로드한 양식 불러오는 중...");
      try {
        const record = await getTemplateFromIDB(templateIdFromUrl);
        if (!record) throw new Error("저장된 템플릿을 찾을 수 없습니다.");
        await loadTemplate(record.buffer, record.name);
        setMessages((prev) => [
          ...prev,
          { role: "ai", text: `'${record.name}' 양식이 로드되었습니다. 자료를 추가하고 AI 자동 채우기를 실행하세요.` },
        ]);
      } catch (err) {
        console.error("templateId 로드 실패:", err);
        setMessages((prev) => [
          ...prev,
          { role: "ai", text: "양식 로드 실패. 직접 DOCX를 업로드해주세요." },
        ]);
      } finally {
        setIsLoading(false);
        setLoadingMessage(null);
      }
    })();
  }, [templateIdFromUrl, workspaceIdFromUrl, loadTemplate]);

  /* ─── DOCX 양식 업로드 ─── */

  const onUploadDocxTemplate = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.currentTarget;
      const file = input.files?.[0];
      if (!file) return;

      setIsLoading(true);
      setLoadError(null);
      setLoadingMessage("DOCX 템플릿 적용 중...");
      setMessages((prev) => [...prev, { role: "ai", text: "DOCX 업로드 중..." }]);

      try {
        const buf = await file.arrayBuffer();
        await loadTemplate(buf, file.name);

        const newId = await saveTemplateToIDB(file.name, buf);
        setActiveTemplateId(newId);
        loadedKeyRef.current = `${type}::${newId}`;

        const url = new URL(window.location.href);
        url.searchParams.set("templateId", newId);
        window.history.replaceState(null, "", url.toString());

        setMessages((prev) => [...prev, { role: "ai", text: "DOCX 템플릿 적용 완료." }]);
      } catch (err) {
        console.error(err);
        setLoadError("DOCX 업로드 실패.");
        setMessages((prev) => [...prev, { role: "ai", text: "DOCX 업로드 실패." }]);
      } finally {
        input.value = "";
        setIsLoading(false);
        setLoadingMessage(null);
      }
    },
    [loadTemplate, type]
  );

  /* ─── 슬롯 선택 헬퍼 ─── */

  const toggleSlotKey = useCallback((key: string) => {
    setSelectedSlotKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearSelectedSlots = useCallback(() => {
    setSelectedSlotKeys(new Set());
  }, []);

  // 드래그 선택: 마우스 누른 채로 슬롯 위를 쓸면 일괄 선택/해제
  const dragRef = useRef<{ active: boolean; mode: "select" | "deselect" }>({ active: false, mode: "select" });

  const onSlotDragStart = useCallback((key: string) => {
    // 첫 클릭한 슬롯이 선택 안 됐으면 → select 모드, 선택 됐으면 → deselect 모드
    setSelectedSlotKeys((prev) => {
      const isSelected = prev.has(key);
      dragRef.current = { active: true, mode: isSelected ? "deselect" : "select" };
      const next = new Set(prev);
      if (isSelected) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const onSlotDragEnter = useCallback((key: string) => {
    if (!dragRef.current.active) return;
    setSelectedSlotKeys((prev) => {
      const next = new Set(prev);
      if (dragRef.current.mode === "select") next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const onSlotDragEnd = useCallback(() => {
    dragRef.current.active = false;
  }, []);

  // window mouseup으로 드래그 종료 (패널 밖에서 마우스 뗄 때도 처리)
  useEffect(() => {
    const handler = () => { dragRef.current.active = false; };
    window.addEventListener("mouseup", handler);
    return () => window.removeEventListener("mouseup", handler);
  }, []);

  /* ─── 슬롯 직접 편집 ─── */

  const startEditSlot = useCallback((key: string) => {
    const prev = lastResults.find((r) => r.key === key);
    const slot = slots.find((s) => s.key === key);
    setEditingSlotKey(key);
    setEditingSlotValue(prev?.value || slot?.currentText || "");
  }, [lastResults, slots]);

  const cancelEditSlot = useCallback(() => {
    setEditingSlotKey(null);
    setEditingSlotValue("");
  }, []);

  const saveEditSlot = useCallback(async () => {
    if (!editingSlotKey || !docxBuffer) return;

    const newValue = editingSlotValue;
    const slot = slots.find((s) => s.key === editingSlotKey);
    if (!slot) return;

    // lastResults 업데이트
    setLastResults((prev) => {
      const exists = prev.find((r) => r.key === editingSlotKey);
      if (exists) return prev.map((r) => r.key === editingSlotKey ? { ...r, value: newValue } : r);
      return [...prev, { key: editingSlotKey, value: newValue }];
    });

    // DOCX 채우기
    try {
      setIsLoading(true);
      setLoadingMessage("슬롯 값 반영 중...");

      // 전체 results에서 해당 키만 업데이트하여 fill-ops 호출
      const updatedResults = lastResults.map((r) =>
        r.key === editingSlotKey ? { ...r, value: newValue } : r
      );
      if (!updatedResults.find((r) => r.key === editingSlotKey)) {
        updatedResults.push({ key: editingSlotKey, value: newValue });
      }

      const ops = updatedResults
        .map((r) => {
          const s = slots.find((sl) => sl.key === r.key);
          if (!s) return null;
          return { key: r.key, xmlPath: s.xmlPath, value: r.value };
        })
        .filter(Boolean);

      const fillForm = new FormData();
      fillForm.append(
        "template",
        new Blob([docxBuffer], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
        "template.docx"
      );
      fillForm.append("ops", JSON.stringify(ops));

      const fillRes = await fetch("/api/docx/fill-ops", { method: "POST", body: fillForm });
      if (!fillRes.ok) throw new Error("DOCX 반영 실패");
      const filledBuf = await fillRes.arrayBuffer();

      const upload = await uploadDocxToServer(filledBuf, "filled_document.docx");
      setDocxBuffer(filledBuf);
      setEditorFileUrl(upload.url);
      setEditorFileId(upload.fileId);
      setEditorAccessToken(upload.accessToken);
      setEditorFileName(upload.fileName);
      setEditorKey(`${upload.fileId}_${Date.now()}`);
      setFilledFileId(upload.fileId);

      setMessages((prev) => [
        ...prev,
        { role: "ai", text: `슬롯 "${slot.label.substring(0, 30)}" 값이 수정되었습니다.` },
      ]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [...prev, { role: "ai", text: "슬롯 값 반영 중 오류가 발생했습니다." }]);
    } finally {
      setIsLoading(false);
      setLoadingMessage(null);
      setEditingSlotKey(null);
      setEditingSlotValue("");
    }
  }, [editingSlotKey, editingSlotValue, docxBuffer, lastResults, slots]);

  /* ─── AI 자동 채우기 ─── */

  const runAiFill = useCallback(
    async (src: string, userRequest?: string) => {
      if (!docxBuffer) {
        setMessages((prev) => [...prev, { role: "ai", text: "먼저 DOCX 템플릿을 로드해주세요." }]);
        return;
      }
      if (!slots.length) {
        setMessages((prev) => [...prev, { role: "ai", text: "감지된 슬롯이 없습니다." }]);
        return;
      }

      // 소스 텍스트 보관 (채팅 수정 시 재사용)
      if (src) lastSourceTextRef.current = src;

      // 선택된 슬롯이 있으면 targetSlotKeys로 전달
      const targetKeys = selectedSlotKeys.size > 0 ? Array.from(selectedSlotKeys) : undefined;

      setIsLoading(true);
      setLoadError(null);
      setLoadingMessage(
        targetKeys
          ? `선택한 ${targetKeys.length}개 슬롯을 수정하는 중...`
          : "AI가 슬롯을 채우는 중..."
      );

      try {
        // 1) AI 슬롯 생성
        const analyzeRes = await fetch("/api/analyze-form", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slots,
            sourceText: src,
            userRequest,
            previousResults: userRequest && lastResults.length > 0 ? lastResults : undefined,
            targetSlotKeys: targetKeys,
          }),
        });
        if (!analyzeRes.ok) {
          const errData = await analyzeRes.json().catch(() => ({}));
          throw new Error(errData.error || errData.detail || "AI 분석 실패");
        }
        const analyzeData = (await analyzeRes.json()) as {
          results: { key: string; value: string }[];
          editedCount?: number;
          editedDetails?: Array<{ key: string; label: string; before: string; after: string }>;
          contentMatchedSlots?: Array<{ key: string; label: string }>;
        };
        const { results, editedCount, editedDetails, contentMatchedSlots } = analyzeData;
        if (!results?.length) throw new Error("AI 결과가 비어있습니다.");

        // 결과 저장 (다음 채팅 요청 시 이전 값 유지용)
        setLastResults(results);

        // 2) DOCX 채우기
        setLoadingMessage("DOCX에 내용 삽입 중...");
        const ops = results
          .map((r) => {
            const slot = slots.find((s) => s.key === r.key);
            if (!slot) return null;
            return { key: r.key, xmlPath: slot.xmlPath, value: r.value };
          })
          .filter(Boolean);

        const fillForm = new FormData();
        fillForm.append(
          "template",
          new Blob([docxBuffer], {
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          }),
          "template.docx"
        );
        fillForm.append("ops", JSON.stringify(ops));

        const fillRes = await fetch("/api/docx/fill-ops", {
          method: "POST",
          body: fillForm,
        });
        if (!fillRes.ok) throw new Error("DOCX 채우기 실패");
        const filledBuf = await fillRes.arrayBuffer();

        // 3) 채운 DOCX를 서버에 업로드 → OnlyOffice로 표시
        setLoadingMessage("결과 표시 중...");
        const upload = await uploadDocxToServer(filledBuf, "filled_document.docx");
        setDocxBuffer(filledBuf);
        setEditorFileUrl(upload.url);
        setEditorFileId(upload.fileId);
        setEditorAccessToken(upload.accessToken);
        setEditorFileName(upload.fileName);
        setEditorKey(`${upload.fileId}_${Date.now()}`);
        setFilledFileId(upload.fileId);

        const isEdit = typeof editedCount === "number";
        let msg: string;
        if (isEdit) {
          if (editedCount === 0) {
            if (contentMatchedSlots && contentMatchedSlots.length > 0) {
              const slotNames = contentMatchedSlots.slice(0, 5).map(s => `"${s.label}"`).join(", ");
              msg = `해당 부분의 슬롯 ${contentMatchedSlots.length}개를 찾았습니다 (${slotNames}).\n하지만 어떤 값으로 바꿀지 모르겠습니다. 구체적으로 알려주세요.\n예: "학번을 20230001로 바꿔줘" 또는 슬롯을 직접 클릭해서 수정하세요.`;
            } else {
              msg = "수정 요청을 처리했지만, 일치하는 슬롯을 찾지 못했습니다. 슬롯을 직접 선택하거나 더 구체적으로 요청해주세요.";
            }
          } else {
            const detailLines = (editedDetails || []).slice(0, 5).map(
              (d) => `• ${d.label}: "${d.before}" → "${d.after}"`
            );
            msg = `수정 완료! ${editedCount}개 슬롯 변경:\n${detailLines.join("\n")}`;
            if ((editedDetails || []).length > 5) msg += `\n... 외 ${editedDetails!.length - 5}개`;
          }
        } else {
          msg = `자동 채움 완료! ${results.length}개 슬롯에 내용이 삽입되었습니다.`;
        }
        setMessages((prev) => [...prev, { role: "ai", text: msg }]);

        // 수정 성공 후 선택 초기화
        if (targetKeys) clearSelectedSlots();
      } catch (err) {
        console.error(err);
        setLoadError("AI 자동 채움 실패.");
        setMessages((prev) => [
          ...prev,
          { role: "ai", text: `AI 자동 채움 실패: ${err}` },
        ]);
      } finally {
        setIsLoading(false);
        setLoadingMessage(null);
      }
    },
    [docxBuffer, slots, lastResults, selectedSlotKeys, clearSelectedSlots]
  );

  /* ─── 자료 업로드 (PDF/DOCX 텍스트 추출 → 배열에 추가) ─── */

  const onUploadSource = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.currentTarget;
      const files = input.files;
      if (!files || files.length === 0) return;

      for (let fi = 0; fi < files.length; fi++) {
        const file = files[fi];
        setMessages((prev) => [...prev, { role: "ai", text: `파일 추가됨: ${file.name}` }]);

        try {
          let text = "";
          if (file.name.toLowerCase().endsWith(".docx")) {
            const mammoth = await import("mammoth");
            const ab = await file.arrayBuffer();
            const result = await mammoth.extractRawText({ arrayBuffer: ab });
            text = (result.value || "").trim();
          } else {
            // @ts-expect-error pdfjs-dist/build/pdf.mjs has no type declarations
            const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
            if (pdfjs.GlobalWorkerOptions) {
              pdfjs.GlobalWorkerOptions.workerSrc = new URL(
                "pdfjs-dist/build/pdf.worker.min.mjs",
                import.meta.url
              ).toString();
            }
            const ab = await file.arrayBuffer();
            const pdf = await pdfjs.getDocument({ data: ab }).promise;
            const parts: string[] = [];
            for (let i = 1; i <= pdf.numPages; i++) {
              const page = await pdf.getPage(i);
              const content = await page.getTextContent();
              const t = content.items
                .map((item: any) => ("str" in item ? item.str : ""))
                .join(" ")
                .trim();
              if (t) parts.push(t);
            }
            text = parts.join("\n").trim();
          }
          setSourceFiles((prev) => [...prev, { name: file.name, text }]);
        } catch (err) {
          console.error(err);
          setMessages((prev) => [...prev, { role: "ai", text: `파일 분석 실패: ${file.name}` }]);
        }
      }
      input.value = "";
    },
    []
  );

  /* ─── 소스 파일 개별 삭제 ─── */

  const onRemoveSourceFile = useCallback((index: number) => {
    setSourceFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  /* ─── AI 자동 채우기 버튼 ─── */

  const onAutoFill = useCallback(async () => {
    await runAiFill(combinedSourceText || "");
  }, [runAiFill, combinedSourceText]);

  /* ─── AI 채팅 (의도 자동 판단: 답변 vs 수정) ─── */

  const askAI = useCallback(
    async (question: string, chatHistory: ChatMsg[]) => {
      setIsLoading(true);
      setLoadingMessage("AI가 답변하는 중...");
      try {
        // 문서 컨텍스트: 슬롯/결과 요약
        let docContext = "";
        if (slots.length > 0) {
          const filledCount = lastResults.filter((r) => r.value && r.value.trim()).length;
          const emptySlots = slots.filter(
            (s) => !lastResults.find((r) => r.key === s.key && r.value?.trim())
          );
          docContext = `[현재 문서 상태]\n- 문서 유형: ${type}\n- 총 슬롯: ${slots.length}개\n- 채워진 슬롯: ${filledCount}개\n- 빈 슬롯: ${emptySlots.length}개`;
          if (emptySlots.length > 0 && emptySlots.length <= 20) {
            docContext += `\n- 빈 슬롯 목록: ${emptySlots.map((s) => s.label || s.key).join(", ")}`;
          }
        }

        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: question,
            type,
            history: chatHistory,
            docContext,
            hasSlots: slots.length > 0,
          }),
        });
        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          console.error("AI 응답 오류:", res.status, errBody);
          throw new Error("AI 응답 실패");
        }
        const data = await res.json();

        // 슬롯이 선택되어 있으면 무조건 수정 모드
        const forceModify = selectedSlotKeys.size > 0;

        // action에 따라 분기
        if ((data.action === "modify" || forceModify) && slots.length > 0) {
          // AI가 수정 요청으로 판단 또는 슬롯 선택됨 → 슬롯 채우기 실행
          setMessages((prev) => [...prev, { role: "ai", text: data.result || "수정을 시작합니다..." }]);
          setIsLoading(false);
          setLoadingMessage(null);
          // 현재 소스 텍스트 또는 이전에 보관된 소스 텍스트 사용
          // 유저가 채팅에 여러 줄 데이터를 붙여넣은 경우 소스 텍스트에 포함
          let srcText = combinedSourceText || lastSourceTextRef.current || "";
          const lines = question.split("\n");
          if (lines.length >= 3) {
            srcText = srcText
              ? `${srcText}\n\n[채팅에서 입력된 데이터]\n${question}`
              : question;
          }
          await runAiFill(srcText, question);
        } else {
          // 일반 답변
          setMessages((prev) => [...prev, { role: "ai", text: data.result || "답변을 생성하지 못했습니다." }]);
          setIsLoading(false);
          setLoadingMessage(null);
        }
      } catch (err) {
        console.error("askAI error:", err);
        setMessages((prev) => [...prev, { role: "ai", text: "AI 답변 생성에 실패했습니다. 다시 시도해주세요." }]);
        setIsLoading(false);
        setLoadingMessage(null);
      }
    },
    [type, slots, lastResults, runAiFill, combinedSourceText, selectedSlotKeys]
  );

  /* ─── 채팅 ─── */

  const onChatSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const input = chatInput.trim();
      // 텍스트 입력이나 소스 파일 중 하나라도 있어야 전송
      if (!input && sourceFiles.length === 0) return;
      if (isLoading) return; // 이미 로딩 중이면 중복 전송 방지
      setChatInput("");

      // 보낸 내용 표시
      const parts: string[] = [];
      if (sourceFiles.length > 0) {
        parts.push(`[자료 ${sourceFiles.length}개: ${sourceFiles.map((f) => f.name).join(", ")}]`);
      }
      if (input) parts.push(input);
      const userMsg: ChatMsg = { role: "user", text: parts.join("\n") };
      setMessages((prev) => [...prev, userMsg]);

      // 자료 파일이 첨부된 경우 → 바로 슬롯 채우기
      if (sourceFiles.length > 0 && slots.length > 0) {
        const textToSend = combinedSourceText;
        setSourceFiles([]);
        await runAiFill(textToSend, input || undefined);
      } else if (input) {
        // 텍스트만 → AI가 의도 자동 판단 (답변 or 수정)
        setSourceFiles([]);
        const historySnapshot = [...messages, userMsg];
        await askAI(input, historySnapshot);
      }
    },
    [chatInput, runAiFill, askAI, combinedSourceText, sourceFiles, slots, isLoading, messages]
  );

  /* ─── Enter 키로 전송 (Shift+Enter = 줄바꿈) ─── */

  const onChatKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.currentTarget.form?.requestSubmit();
      }
    },
    []
  );

  /* ─── 다운로드 ─── */

  const onDownload = useCallback(() => {
    if (!docxBuffer) return;
    const blob = new Blob([docxBuffer], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = editorFileName || "document.docx";
    a.click();
    URL.revokeObjectURL(url);
  }, [docxBuffer, editorFileName]);

  /* ─── 자동 저장 (디바운스 2초) ─── */

  const triggerAutoSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (!slots.length && !lastResults.length) return; // 저장할 내용 없음
      try {
        const id = await saveWorkspace({
          id: workspaceId || undefined,
          name: editorFileName || `${type} 문서`,
          type,
          templateId: activeTemplateId,
          templateFileId,
          filledFileId,
          filledBuffer: docxBuffer ?? undefined,
          slots,
          lastResults,
          sourceTexts: sourceFiles,
          messages,
        });
        if (!workspaceId) {
          setWorkspaceId(id);
          const url = new URL(window.location.href);
          url.searchParams.set("workspaceId", id);
          window.history.replaceState(null, "", url.toString());
        }
      } catch (err) {
        console.warn("자동 저장 실패:", err);
      }
    }, 2000);
  }, [workspaceId, type, activeTemplateId, templateFileId, filledFileId, docxBuffer, slots, lastResults, sourceFiles, messages, editorFileName]);

  // 주요 상태 변경 시 자동 저장
  useEffect(() => {
    if (lastResults.length > 0) triggerAutoSave();
  }, [lastResults, triggerAutoSave]);

  useEffect(() => {
    if (sourceFiles.length > 0) triggerAutoSave();
  }, [sourceFiles, triggerAutoSave]);

  /* ─── 워크스페이스 복원 (이어하기) ─── */

  useEffect(() => {
    if (!workspaceIdFromUrl) return;
    if (autoLoadedRef.current) return;
    autoLoadedRef.current = true;

    (async () => {
      setIsLoading(true);
      setLoadingMessage("저장된 프로젝트 불러오는 중...");
      try {
        const ws = await getWorkspace(workspaceIdFromUrl);
        if (!ws) {
          setMessages((prev) => [...prev, { role: "ai", text: "저장된 프로젝트를 찾을 수 없습니다." }]);
          return;
        }

        // 상태 복원
        setSlots(ws.slots || []);
        setLastResults(ws.lastResults || []);
        setSourceFiles(ws.sourceTexts || []);
        setMessages(ws.messages?.length ? ws.messages : [{ role: "ai", text: `'${ws.name}' 프로젝트를 이어서 작업합니다.` }]);
        setActiveTemplateId(ws.templateId || "");
        setTemplateFileId(ws.templateFileId || "");
        setFilledFileId(ws.filledFileId || "");

        // DOCX 복원: filledBuffer 우선, 없으면 templateStore에서 가져오기
        const buffer = ws.filledBuffer || (ws.templateId ? (await getTemplateFromIDB(ws.templateId))?.buffer : undefined);
        if (buffer) {
          setDocxBuffer(buffer);
          const upload = await uploadDocxToServer(buffer, ws.name || "document.docx");
          setEditorFileUrl(upload.url);
          setEditorFileId(upload.fileId);
          setEditorAccessToken(upload.accessToken);
          setEditorFileName(upload.fileName);
          setEditorKey(`${upload.fileId}_${Date.now()}`);
          setFilledFileId(upload.fileId);
        }

        setMessages((prev) => [...prev, { role: "ai", text: `프로젝트 복원 완료. ${ws.slots?.length || 0}개 슬롯, ${ws.lastResults?.length || 0}개 결과 로드됨.` }]);
      } catch (err) {
        console.error("워크스페이스 복원 실패:", err);
        setMessages((prev) => [...prev, { role: "ai", text: "프로젝트 복원 실패." }]);
      } finally {
        setIsLoading(false);
        setLoadingMessage(null);
      }
    })();
  }, [workspaceIdFromUrl, loadTemplate]);

/* ─── render ─── */

  return (
    <div className={styles.page}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <span
            className={styles.sidebarHeaderTitle}
            onClick={() => router.push("/")}
            style={{ cursor: "pointer" }}
          >
            REPOT AI
          </span>
          <div className={styles.sidebarHeaderMeta}>{type}</div>
        </div>

        {/* 파일 업로드 */}
        <div className={styles.uploadSection}>
          <div className={styles.sectionLabel}>파일 업로드</div>
          <div className={styles.uploadButtons}>
            <label className={styles.docxUpload}>
              양식 (DOCX)
              <input type="file" accept=".docx" hidden onChange={onUploadDocxTemplate} />
            </label>
            <label className={styles.pdfUpload}>
              자료 추가
              <input type="file" accept=".pdf,.docx" hidden multiple onChange={onUploadSource} />
            </label>
          </div>
          {isLoading && (
            <div className={styles.loadingIndicator}>
              <span className={styles.loadingDot} />
              {loadingMessage || "처리 중..."}
            </div>
          )}
        </div>

        {/* AI 자동 채우기 + 다운로드 */}
        <div className={styles.actionSection}>
          <button
            type="button"
            className={styles.actionPrimary}
            onClick={onAutoFill}
            disabled={isLoading || !slots.length}
          >
            AI 자동 채우기
          </button>
          <button
            type="button"
            className={styles.actionSecondary}
            onClick={onDownload}
            disabled={!docxBuffer}
          >
            다운로드
          </button>
        </div>

        {slots.length > 0 && (
          <div className={styles.slotSection}>
            <div className={styles.slotSectionHeader}>
              <span className={styles.slotBadge}>슬롯 {slots.length}개 감지</span>
              <button
                type="button"
                className={`${styles.slotToggleBtn} ${slotPanelOpen ? styles.slotToggleBtnActive : ""}`}
                onClick={() => setSlotPanelOpen((v) => !v)}
              >
                {slotPanelOpen ? "닫기" : "슬롯 선택"}
                {selectedSlotKeys.size > 0 && (
                  <span className={styles.slotCount}>{selectedSlotKeys.size}</span>
                )}
              </button>
            </div>

            {/* 선택된 슬롯 칩 (패널 닫혀도 보임) */}
            {selectedSlotKeys.size > 0 && !slotPanelOpen && (
              <div className={styles.selectedChips}>
                {Array.from(selectedSlotKeys).slice(0, 5).map((key) => {
                  const slot = slots.find((s) => s.key === key);
                  return (
                    <span key={key} className={styles.selectedChip}>
                      {(slot?.label || key).substring(0, 20)}
                      <button
                        type="button"
                        className={styles.chipDelete}
                        onClick={() => toggleSlotKey(key)}
                      >
                        &times;
                      </button>
                    </span>
                  );
                })}
                {selectedSlotKeys.size > 5 && (
                  <span className={styles.selectedChip}>+{selectedSlotKeys.size - 5}개</span>
                )}
                <button
                  type="button"
                  className={styles.clearAllBtn}
                  onClick={clearSelectedSlots}
                >
                  전체 해제
                </button>
              </div>
            )}

            {/* 슬롯 선택 패널 */}
            {slotPanelOpen && (
              <div className={styles.slotPanel}>
                <input
                  type="text"
                  value={slotSearch}
                  onChange={(e) => setSlotSearch(e.target.value)}
                  placeholder="슬롯 검색..."
                  className={styles.slotSearchInput}
                />
                {selectedSlotKeys.size > 0 && (
                  <div className={styles.slotPanelActions}>
                    <span className={styles.slotPanelCount}>{selectedSlotKeys.size}개 선택됨</span>
                    <button type="button" className={styles.clearAllBtn} onClick={clearSelectedSlots}>
                      전체 해제
                    </button>
                  </div>
                )}
                <div className={styles.slotList} onMouseUp={onSlotDragEnd}>
                  {(() => {
                    const searchLower = slotSearch.toLowerCase();
                    const groups: Record<string, SlotInfo[]> = {};
                    for (const s of slots) {
                      if (searchLower && !(s.label.toLowerCase().includes(searchLower) || s.key.toLowerCase().includes(searchLower) || s.currentText.toLowerCase().includes(searchLower))) continue;
                      const group = s.kind === "TABLE_CELL"
                        ? `표 ${s.xmlPath.match(/table\[(\d+)\]/)?.[1] || "?"}`
                        : s.kind === "BODY_SECTION" ? "본문 섹션"
                        : "텍스트박스";
                      if (!groups[group]) groups[group] = [];
                      groups[group].push(s);
                    }
                    return Object.entries(groups).map(([groupName, groupSlots]) => (
                      <div key={groupName} className={styles.slotGroup}>
                        <div className={styles.slotGroupHeader}>{groupName} ({groupSlots.length})</div>
                        {groupSlots.map((s) => {
                          const prevResult = lastResults.find((r) => r.key === s.key);
                          const displayText = prevResult?.value || s.currentText;
                          const isEditing = editingSlotKey === s.key;
                          return (
                            <div key={s.key}>
                              <div
                                className={`${styles.slotItem} ${selectedSlotKeys.has(s.key) ? styles.slotItemSelected : ""} ${s.structural ? styles.slotItemStructural : ""}`}
                                onMouseDown={(e) => { e.preventDefault(); onSlotDragStart(s.key); }}
                                onMouseEnter={() => onSlotDragEnter(s.key)}
                                onDoubleClick={(e) => { e.stopPropagation(); startEditSlot(s.key); }}
                                title="더블클릭으로 직접 편집"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedSlotKeys.has(s.key)}
                                  onChange={() => {}}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  className={styles.slotCheckbox}
                                  tabIndex={-1}
                                />
                                <div className={styles.slotItemContent}>
                                  <div className={styles.slotItemLabel}>
                                    {s.structural && <span className={styles.structuralTag}>구조</span>}
                                    {s.label.substring(0, 40)}
                                  </div>
                                  {displayText && (
                                    <div className={styles.slotItemPreview}>
                                      {displayText.substring(0, 60)}{displayText.length > 60 ? "..." : ""}
                                    </div>
                                  )}
                                </div>
                              </div>
                              {isEditing && (
                                <div className={styles.slotEditPanel}>
                                  <textarea
                                    className={styles.slotEditTextarea}
                                    value={editingSlotValue}
                                    onChange={(e) => setEditingSlotValue(e.target.value)}
                                    rows={4}
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === "Escape") cancelEditSlot();
                                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) saveEditSlot();
                                    }}
                                  />
                                  <div className={styles.slotEditActions}>
                                    <button type="button" className={styles.slotEditSave} onClick={saveEditSlot}>
                                      저장 (Ctrl+Enter)
                                    </button>
                                    <button type="button" className={styles.slotEditCancel} onClick={cancelEditSlot}>
                                      취소
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 메시지 */}
        <div className={styles.messageList}>
          {messages.map((m, i) => (
            <div
              key={i}
              className={`${styles.msgBubble} ${m.role === "user" ? styles.msgUser : styles.msgAi}`}
            >
              {m.text}
            </div>
          ))}
        </div>

        {/* 소스 파일 칩 + 채팅 입력 (ChatGPT 스타일) */}
        <form onSubmit={onChatSubmit} className={styles.chatForm}>
          <div className={styles.chatInputWrapper}>
            {(sourceFiles.length > 0 || selectedSlotKeys.size > 0) && (
              <div className={styles.chipList} style={{ padding: "12px 16px 0" }}>
                {selectedSlotKeys.size > 0 && (
                  <span className={styles.chipTarget}>
                    {selectedSlotKeys.size}개 슬롯 대상
                    <button type="button" className={styles.chipDelete} onClick={clearSelectedSlots}>&times;</button>
                  </span>
                )}
                {sourceFiles.map((f, i) => (
                  <span key={i} className={styles.chip}>
                    {f.name}
                    <button
                      type="button"
                      className={styles.chipDelete}
                      onClick={() => onRemoveSourceFile(i)}
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={onChatKeyDown}
              placeholder="무엇이든 물어보세요"
              rows={1}
              className={styles.chatInput}
            />
            <button type="submit" className={styles.chatSendBtn}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </div>
        </form>
      </aside>

      <main className={styles.main}>
        <div className={styles.editorWrapper}>
          {editorFileUrl ? (
            <OnlyOfficeEditor
              key={editorKey}
              fileUrl={editorFileUrl}
              fileId={editorFileId}
              accessToken={editorAccessToken}
              fileName={editorFileName}
              documentKey={editorKey}
              mode="edit"
              className={styles.editorFrame}
            />
          ) : (
            <div
              className={styles.editorFrame}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#94a3b8",
                fontSize: 15,
              }}
            >
              DOCX 템플릿을 업로드하세요
            </div>
          )}

          {(isLoading || loadError) && (
            <div className={styles.overlay}>
              <div className={styles.overlayContent}>
                <div className={styles.overlayTitle}>
                  {loadError || loadingMessage || "처리 중..."}
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
