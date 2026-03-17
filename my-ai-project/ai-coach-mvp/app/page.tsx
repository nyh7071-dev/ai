"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { saveTemplateToIDB } from "@/lib/templateStore";
import { listWorkspaces, deleteWorkspace, type WorkspaceRecord } from "@/lib/workspaceStore";

type Category = { name: string; icon: string; file: string };

const categories: Category[] = [
  { name: "레포트", icon: "📄", file: "/templates/report.pdf" },
  { name: "실험보고서", icon: "🧪", file: "/templates/lab_report.pdf" },
  { name: "논문", icon: "🎓", file: "/templates/thesis.pdf" },
  { name: "강의노트", icon: "📝", file: "/templates/lecture_note.pdf" },
  { name: "문헌고찰", icon: "📚", file: "/templates/review.pdf" },
];

function timeAgo(ts: number) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금 전";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export default function HomePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docxPreviewRef = useRef<HTMLDivElement>(null);
  const [docxPreviewUrl, setDocxPreviewUrl] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"new" | "recent">("new");
  const [selectedType, setSelectedType] = useState("레포트");
  const [selectedPdf, setSelectedPdf] = useState("/templates/report.pdf");
  const [uploadedDocx, setUploadedDocx] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [loadingWs, setLoadingWs] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSessionEmail(data.session?.user.email ?? null);
      setCheckingSession(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setSessionEmail(session?.user.email ?? null);
      setCheckingSession(false);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (activeTab !== "recent") return;
    setLoadingWs(true);
    listWorkspaces(20).then((list) => {
      setWorkspaces(list);
      setLoadingWs(false);
    }).catch(() => setLoadingWs(false));
  }, [activeTab]);

  useEffect(() => {
    if (!uploadedDocx) return;
    let objectUrl: string | null = null;
    uploadedDocx.arrayBuffer().then((buf) => {
      return import("mammoth").then(({ default: mammoth }) =>
        mammoth.convertToHtml({ arrayBuffer: buf })
      );
    }).then((result) => {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        body { margin: 24px 32px; font-family: 'Malgun Gothic', sans-serif; font-size: 11pt; line-height: 1.6; }
        table { border-collapse: collapse; width: 100%; }
        td, th { border: 1px solid #333; padding: 4px 8px; }
      </style></head><body>${result.value}</body></html>`;
      const blob = new Blob([html], { type: "text/html" });
      objectUrl = URL.createObjectURL(blob);
      setDocxPreviewUrl(objectUrl);
    }).catch(console.error);
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [uploadedDocx]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".docx")) {
      alert("DOCX 파일만 업로드 가능합니다.");
      e.currentTarget.value = "";
      return;
    }
    setUploadedDocx(file);
    setSelectedType(file.name.replace(/\.docx$/i, ""));
    e.currentTarget.value = "";
  };

  const handleStart = async () => {
    if (busy) return;
    if (uploadedDocx) {
      setBusy(true);
      try {
        const buffer = await uploadedDocx.arrayBuffer();
        const templateId = await saveTemplateToIDB(uploadedDocx.name, buffer);
        router.push(`/project/new/result?type=${encodeURIComponent(selectedType)}&templateId=${encodeURIComponent(templateId)}`);
      } catch (err) {
        console.error(err);
        setBusy(false);
      }
    } else {
      router.push(`/project/new/result?type=${encodeURIComponent(selectedType)}`);
    }
  };

  const handleContinue = (ws: WorkspaceRecord) => {
    router.push(`/project/new/result?workspaceId=${encodeURIComponent(ws.id)}&type=${encodeURIComponent(ws.type)}`);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteWorkspace(id);
    setWorkspaces((prev) => prev.filter((w) => w.id !== id));
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f8fafc", fontFamily: "'Segoe UI', sans-serif" }}>
      {/* 상단 헤더 */}
      <header style={{
        backgroundColor: "#ffffff",
        borderBottom: "1px solid #e2e8f0",
        padding: "0 40px",
        height: "64px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 100,
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{
            width: "34px", height: "34px", borderRadius: "10px",
            background: "linear-gradient(135deg, #2563eb, #7c3aed)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "16px",
          }}>📄</div>
          <span style={{ fontSize: "20px", fontWeight: 900, fontStyle: "italic", color: "#2563eb", letterSpacing: "-0.5px" }}>
            REPOT AI
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {checkingSession ? null : sessionEmail ? (
            <>
              <div style={{
                display: "flex", alignItems: "center", gap: "8px",
                padding: "6px 14px", backgroundColor: "#f1f5f9",
                borderRadius: "20px", fontSize: "13px", color: "#475569", fontWeight: 600,
              }}>
                <div style={{
                  width: "26px", height: "26px", borderRadius: "50%",
                  background: "linear-gradient(135deg, #2563eb, #7c3aed)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "white", fontSize: "12px", fontWeight: 700,
                }}>
                  {sessionEmail[0].toUpperCase()}
                </div>
                {sessionEmail}
              </div>
              <button
                onClick={async () => { await supabase.auth.signOut(); router.refresh(); }}
                style={{
                  padding: "7px 16px", borderRadius: "10px",
                  border: "1px solid #e2e8f0", backgroundColor: "white",
                  fontSize: "13px", fontWeight: 600, color: "#64748b",
                  cursor: "pointer",
                }}
              >
                로그아웃
              </button>
            </>
          ) : (
            <button
              onClick={() => router.push("/login")}
              style={{
                padding: "8px 20px", borderRadius: "10px",
                border: "none", backgroundColor: "#2563eb",
                fontSize: "14px", fontWeight: 700, color: "white",
                cursor: "pointer", boxShadow: "0 2px 8px rgba(37,99,235,0.3)",
              }}
            >
              로그인
            </button>
          )}
        </div>
      </header>

      {/* 탭 네비게이션 */}
      <div style={{
        backgroundColor: "#ffffff",
        borderBottom: "1px solid #e2e8f0",
        padding: "0 40px",
      }}>
        <div style={{ maxWidth: "1100px", margin: "0 auto", display: "flex", gap: "0" }}>
          {[
            { key: "new", label: "새 문서" },
            { key: "recent", label: "최근 작업" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as "new" | "recent")}
              style={{
                padding: "14px 20px",
                border: "none",
                backgroundColor: "transparent",
                fontSize: "14px",
                fontWeight: 700,
                color: activeTab === tab.key ? "#2563eb" : "#94a3b8",
                borderBottom: activeTab === tab.key ? "2px solid #2563eb" : "2px solid transparent",
                cursor: "pointer",
                transition: "all 0.15s",
                fontFamily: "inherit",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <main style={{ maxWidth: "1200px", margin: "0 auto", padding: "40px 48px" }}>

        {/* 최근 작업 탭 */}
        {activeTab === "recent" && (
          <section>
            {loadingWs ? (
              <div style={{ color: "#94a3b8", fontSize: "14px", textAlign: "center", padding: "60px 0" }}>불러오는 중...</div>
            ) : workspaces.length === 0 ? (
              <div style={{ textAlign: "center", padding: "80px 0", color: "#94a3b8" }}>
                <div style={{ fontSize: "48px", marginBottom: "16px" }}>📂</div>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "#64748b", marginBottom: "8px" }}>최근 작업이 없어요</div>
                <div style={{ fontSize: "13px" }}>새 문서 탭에서 작업을 시작해보세요</div>
              </div>
            ) : (
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: "14px",
              }}>
                {workspaces.map((ws) => (
                  <div
                    key={ws.id}
                    onClick={() => handleContinue(ws)}
                    style={{
                      backgroundColor: "white",
                      borderRadius: "16px",
                      padding: "18px 20px",
                      border: "1px solid #e2e8f0",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      position: "relative",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = "#2563eb";
                      e.currentTarget.style.boxShadow = "0 4px 16px rgba(37,99,235,0.1)";
                      e.currentTarget.style.transform = "translateY(-1px)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "#e2e8f0";
                      e.currentTarget.style.boxShadow = "none";
                      e.currentTarget.style.transform = "translateY(0)";
                    }}
                  >
                    <button
                      onClick={(e) => handleDelete(e, ws.id)}
                      style={{
                        position: "absolute", top: "12px", right: "12px",
                        width: "24px", height: "24px", borderRadius: "6px",
                        border: "none", backgroundColor: "transparent",
                        color: "#cbd5e1", fontSize: "14px", cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#fee2e2"; e.currentTarget.style.color = "#ef4444"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#cbd5e1"; }}
                    >
                      ✕
                    </button>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div style={{
                        width: "36px", height: "36px", borderRadius: "10px",
                        backgroundColor: "#eff6ff", display: "flex",
                        alignItems: "center", justifyContent: "center", fontSize: "18px",
                        flexShrink: 0,
                      }}>
                        {categories.find(c => c.name === ws.type)?.icon || "📄"}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{
                          fontSize: "14px", fontWeight: 700, color: "#0f172a",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {ws.name || ws.type}
                        </div>
                        <div style={{ fontSize: "12px", color: "#94a3b8" }}>{ws.type}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{
                        fontSize: "11px", color: "#2563eb", fontWeight: 600,
                        backgroundColor: "#eff6ff", padding: "3px 8px", borderRadius: "6px",
                      }}>
                        슬롯 {ws.slots?.length || 0}개
                      </span>
                      <span style={{ fontSize: "11px", color: "#94a3b8" }}>{timeAgo(ws.updatedAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* 새 문서 탭 */}
        {activeTab === "new" && (
        <section style={{ display: "flex", gap: "32px", height: "560px" }}>

          {/* 왼쪽: 문서 종류 선택 */}
          <div style={{
            flex: "0 0 480px", backgroundColor: "white", borderRadius: "24px",
            padding: "36px 32px", border: "1px solid #e2e8f0",
            boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
            display: "flex", flexDirection: "column", gap: "24px",
          }}>
            <div>
              <div style={{ fontSize: "20px", fontWeight: 800, color: "#0f172a", marginBottom: "4px" }}>
                문서 종류 선택
              </div>
              <div style={{ fontSize: "14px", color: "#94a3b8" }}>시작할 문서 유형을 선택하세요</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "14px", flex: 1 }}>
              {categories.map((cat) => (
                <button
                  key={cat.name}
                  onClick={() => { setSelectedType(cat.name); setSelectedPdf(cat.file); setUploadedDocx(null); }}
                  style={{
                    padding: "20px 12px",
                    borderRadius: "16px",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "10px",
                    border: selectedType === cat.name && !uploadedDocx ? "2px solid #2563eb" : "1.5px solid #e2e8f0",
                    backgroundColor: selectedType === cat.name && !uploadedDocx ? "#eff6ff" : "#f8fafc",
                    color: selectedType === cat.name && !uploadedDocx ? "#2563eb" : "#475569",
                    transition: "all 0.15s",
                    fontFamily: "inherit",
                  }}
                >
                  <span style={{ fontSize: "36px" }}>{cat.icon}</span>
                  <span style={{ fontSize: "14px", fontWeight: 700 }}>{cat.name}</span>
                </button>
              ))}
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  padding: "20px 12px",
                  borderRadius: "16px",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "10px",
                  border: uploadedDocx ? "2px solid #2563eb" : "1.5px dashed #cbd5e1",
                  backgroundColor: uploadedDocx ? "#eff6ff" : "#f8fafc",
                  color: uploadedDocx ? "#2563eb" : "#94a3b8",
                  transition: "all 0.15s",
                  fontFamily: "inherit",
                }}
              >
                <span style={{ fontSize: "36px" }}>{uploadedDocx ? "✅" : "➕"}</span>
                <span style={{ fontSize: "14px", fontWeight: 700 }}>
                  {uploadedDocx ? "업로드됨" : "내 양식 업로드"}
                </span>
              </button>
            </div>

            <input type="file" ref={fileInputRef} style={{ display: "none" }} accept=".docx" onChange={handleFileChange} />

            <button
              onClick={handleStart}
              disabled={busy}
              style={{
                width: "100%", padding: "18px",
                background: busy ? "#93c5fd" : "linear-gradient(135deg, #2563eb, #1d4ed8)",
                color: "white", border: "none", borderRadius: "16px",
                fontSize: "16px", fontWeight: 800, cursor: busy ? "not-allowed" : "pointer",
                boxShadow: busy ? "none" : "0 4px 20px rgba(37,99,235,0.4)",
                transition: "all 0.2s",
                fontFamily: "inherit",
              }}
            >
              {busy ? "처리 중..." : "이 양식으로 분석 시작하기 →"}
            </button>
          </div>

          {/* 오른쪽: 미리보기 */}
          <div style={{
            flex: "0 0 500px", backgroundColor: "white", borderRadius: "24px",
            border: "1px solid #e2e8f0", padding: "12px",
            display: "flex", flexDirection: "column",
            boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
          }}>
            <div style={{ flex: 1, backgroundColor: "#f3f4f6", borderRadius: "16px", overflow: "hidden", position: "relative" }}>
              {/* PDF 미리보기 */}
              <iframe
                key={selectedPdf}
                src={`${selectedPdf}#toolbar=0&view=FitH`}
                style={{ width: "100%", height: "100%", border: "none", display: uploadedDocx ? "none" : "block" }}
              />
              {/* DOCX 미리보기 */}
              {uploadedDocx && docxPreviewUrl && (
                <iframe
                  src={docxPreviewUrl}
                  style={{ width: "100%", height: "100%", border: "none" }}
                />
              )}
            </div>
            <div style={{ padding: "14px 0 6px", textAlign: "center" }}>
              <span style={{ color: "#2563eb", fontWeight: 700, fontSize: "14px" }}>
                미리보기: {uploadedDocx ? uploadedDocx.name.replace(/\.docx$/i, "") : selectedType}
              </span>
            </div>
          </div>
        </section>
        )}
      </main>
    </div>
  );
}
