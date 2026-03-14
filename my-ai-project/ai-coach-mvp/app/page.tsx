"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Category = {
  name: string;
  icon: string;
  file: string;
};

const categories: Category[] = [
  { name: "레포트", icon: "📄", file: "/templates/report.pdf" },
  { name: "실험보고서", icon: "🧪", file: "/templates/lab_report.pdf" },
  { name: "논문", icon: "🎓", file: "/templates/thesis.pdf" },
  { name: "강의노트", icon: "📝", file: "/templates/lecture_note.pdf" },
  { name: "문헌고찰", icon: "📚", file: "/templates/review.pdf" },
  { name: "내 양식 업로드", icon: "➕", file: "custom" },
];

export default function MainUploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedName, setSelectedName] = useState("레포트");
  const [selectedPdf, setSelectedPdf] = useState("/templates/report.pdf");
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSessionEmail(data.session?.user.email ?? null);
      setCheckingSession(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionEmail(session?.user.email ?? null);
      setCheckingSession(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleCardClick = (cat: Category) => {
    if (cat.file === "custom") {
      fileInputRef.current?.click();
      return;
    }

    setSelectedName(cat.name);
    setSelectedPdf(cat.file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      alert("PDF 파일만 업로드 가능합니다.");
      e.currentTarget.value = "";
      return;
    }

    const fileUrl = URL.createObjectURL(file);
    setSelectedPdf(fileUrl);
    setSelectedName(file.name.replace(/\.pdf$/i, ""));
  };

  const handleAnalyzeClick = () => {
    router.push(`/project/new/result?type=${encodeURIComponent(selectedName)}`);
  };

  const handleLoginClick = () => {
    router.push("/login");
  };

  const handleLogoutClick = async () => {
    await supabase.auth.signOut();
    router.refresh();
  };

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        backgroundColor: "#f3f4f6",
        fontFamily: "sans-serif",
      }}
    >
      <aside
        style={{
          width: "280px",
          backgroundColor: "white",
          borderRight: "1px solid #e5e7eb",
          display: "flex",
          flexDirection: "column",
          padding: "30px 20px",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            color: "#2563eb",
            fontWeight: 900,
            fontStyle: "italic",
            fontSize: "22px",
            marginBottom: "20px",
          }}
        >
          REPOT AI
        </div>

        <div
          style={{
            marginBottom: "24px",
            padding: "14px 16px",
            borderRadius: "16px",
            backgroundColor: "#f8fafc",
            border: "1px solid #e2e8f0",
          }}
        >
          <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "6px", fontWeight: 700 }}>
            로그인 상태
          </div>
          <div style={{ fontSize: "14px", color: "#0f172a", fontWeight: 700, marginBottom: "12px" }}>
            {checkingSession ? "확인 중..." : sessionEmail ? `로그인됨: ${sessionEmail}` : "로그인 안 됨"}
          </div>
          {sessionEmail ? (
            <button
              onClick={handleLogoutClick}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: "12px",
                border: "1px solid #cbd5e1",
                backgroundColor: "#ffffff",
                color: "#0f172a",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              로그아웃
            </button>
          ) : (
            <button
              onClick={handleLoginClick}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: "12px",
                border: "none",
                backgroundColor: "#2563eb",
                color: "#ffffff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              로그인하러 가기
            </button>
          )}
        </div>

        <nav style={{ flex: 1 }}>
          <div
            style={{
              padding: "12px 16px",
              backgroundColor: "#eff6ff",
              color: "#2563eb",
              borderRadius: "12px",
              fontWeight: 700,
              marginBottom: "8px",
            }}
          >
            문서 작업
          </div>
          <div
            style={{
              padding: "12px 16px",
              color: "#94a3b8",
              borderRadius: "12px",
            }}
          >
            AI 코치
          </div>
        </nav>
      </aside>

      <main
        style={{
          flex: 1,
          padding: "24px 36px",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
          }}
        >
          <div>
            <h1 style={{ fontSize: "28px", fontWeight: 800, color: "#111827", margin: 0 }}>
              문서 종류 선택
            </h1>
            <p style={{ margin: "8px 0 0", color: "#64748b", fontSize: "14px" }}>
              홈에서도 로그인 상태를 확인하고 바로 분석을 시작할 수 있습니다.
            </p>
          </div>
          {!sessionEmail && !checkingSession && (
            <button
              onClick={handleLoginClick}
              style={{
                padding: "12px 16px",
                borderRadius: "14px",
                border: "none",
                backgroundColor: "#111827",
                color: "#ffffff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Google 로그인
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: "24px", flex: 1, minHeight: 0 }}>
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              backgroundColor: "white",
              padding: "24px",
              borderRadius: "28px",
              border: "1px solid #e5e7eb",
              minHeight: 0,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: "14px",
                flex: 1,
                overflowY: "auto",
                paddingRight: "6px",
                marginBottom: "18px",
              }}
            >
              {categories.map((cat) => (
                <button
                  key={cat.name}
                  onClick={() => handleCardClick(cat)}
                  style={{
                    height: "128px",
                    borderRadius: "22px",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    border: selectedName === cat.name ? "2px solid #2563eb" : "1px solid #f1f5f9",
                    backgroundColor: selectedName === cat.name ? "#ffffff" : "#f8fafc",
                    color: selectedName === cat.name ? "#2563eb" : "#475569",
                  }}
                >
                  <span style={{ fontSize: "34px", marginBottom: "8px" }}>{cat.icon}</span>
                  <span style={{ fontWeight: 700 }}>{cat.name}</span>
                </button>
              ))}
            </div>

            <input
              type="file"
              ref={fileInputRef}
              style={{ display: "none" }}
              accept="application/pdf"
              onChange={handleFileChange}
            />

            <button
              onClick={handleAnalyzeClick}
              style={{
                width: "100%",
                padding: "18px",
                backgroundColor: "#2563eb",
                color: "white",
                border: "none",
                borderRadius: "18px",
                fontSize: "17px",
                fontWeight: 800,
                cursor: "pointer",
                boxShadow: "0 10px 25px rgba(37, 99, 235, 0.22)",
              }}
            >
              이 양식으로 분석 시작하기
            </button>
          </div>

          <div
            style={{
              flex: 1,
              backgroundColor: "white",
              borderRadius: "28px",
              border: "1px solid #e5e7eb",
              padding: "10px",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <div
              style={{
                flex: 1,
                backgroundColor: "#f3f4f6",
                borderRadius: "24px",
                overflow: "hidden",
                border: "1px solid #eef2f7",
              }}
            >
              <iframe
                key={selectedPdf}
                src={`${selectedPdf}#toolbar=0&navpanes=0&view=FitH`}
                style={{ width: "100%", height: "100%", border: "none" }}
                title="template-preview"
              />
            </div>
            <div style={{ padding: "12px 4px 6px", textAlign: "center" }}>
              <span style={{ fontSize: "11px", color: "#94a3b8", fontWeight: 700 }}>미리보기: </span>
              <span style={{ fontSize: "15px", color: "#2563eb", fontWeight: 800 }}>{selectedName}</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
