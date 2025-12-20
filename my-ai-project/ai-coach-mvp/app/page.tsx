"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveTemplateToIDB } from "@/lib/templateStore";

const TYPE_OPTIONS = ["레포트", "실험보고서", "논문", "강의노트", "문헌고찰"] as const;
type TemplateType = (typeof TYPE_OPTIONS)[number];

export default function Home() {
  const router = useRouter();
  const [type, setType] = useState<TemplateType>("레포트");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const onUploadTemplate = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setBusy(true);
    setStatus("DOCX 템플릿 저장 중...");

    try {
      const buffer = await file.arrayBuffer();
      const templateId = await saveTemplateToIDB(file.name, buffer);

      router.push(`/result?type=${encodeURIComponent(type)}&templateId=${encodeURIComponent(templateId)}`);
    } catch (err) {
      console.error(err);
      setStatus("DOCX 저장 실패 (F12 콘솔 확인)");
      setBusy(false);
    } finally {
      e.currentTarget.value = "";
    }
  };

  const goDefault = () => {
    router.push(`/result?type=${encodeURIComponent(type)}`);
  };

  return (
    <div style={{ padding: 28, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 900, marginBottom: 14 }}>템플릿 선택</h1>

      <div style={{ padding: 16, border: "1px solid #e2e8f0", borderRadius: 12, background: "#fff" }}>
        <div style={{ fontWeight: 800, marginBottom: 10 }}>작성 유형</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => setType(opt)}
              disabled={busy}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: opt === type ? "2px solid #1e40af" : "1px solid #cbd5e1",
                background: opt === type ? "#eff6ff" : "#fff",
                fontWeight: 800,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              {opt}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={goDefault}
            disabled={busy}
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              border: "1px solid #cbd5e1",
              background: "#0f172a",
              color: "#fff",
              fontWeight: 900,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            기본 템플릿으로 시작
          </button>

          <label
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              border: "1px dashed #1e40af",
              background: "#fff",
              color: "#1e40af",
              fontWeight: 900,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            내 DOCX 템플릿 업로드
            <input type="file" accept=".docx" onChange={onUploadTemplate} disabled={busy} hidden />
          </label>
        </div>

        <div style={{ marginTop: 12, color: "#475569", fontSize: 13 }}>
          {busy ? "처리 중..." : "DOCX 업로드는 여기서 됩니다. PDF 업로드는 다음 화면에서 합니다."}
        </div>
        {status && <div style={{ marginTop: 8, color: "#e11d48", fontWeight: 800 }}>{status}</div>}
      </div>
    </div>
  );
}
