"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isCompletingLogin, setIsCompletingLogin] = useState(false);

  useEffect(() => {
    const code = searchParams.get("code");
    if (!code) return;

    let cancelled = false;

    void (async () => {
      setIsCompletingLogin(true);
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (cancelled) return;

      if (error) {
        console.error("OAuth callback failed:", error);
        setIsCompletingLogin(false);
        return;
      }

      window.location.href = "/";
    })();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  const handleGoogleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      console.error("signInWithOAuth error:", error);
      alert(`로그인 오류: ${error.message}`);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      backgroundColor: "#0f172a",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'Segoe UI', sans-serif",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* 배경 그라디언트 원 */}
      <div style={{
        position: "absolute",
        width: "600px",
        height: "600px",
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(37,99,235,0.15) 0%, transparent 70%)",
        top: "-100px",
        left: "-100px",
        pointerEvents: "none",
      }} />
      <div style={{
        position: "absolute",
        width: "500px",
        height: "500px",
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(139,92,246,0.1) 0%, transparent 70%)",
        bottom: "-80px",
        right: "-80px",
        pointerEvents: "none",
      }} />

      <div style={{
        width: "100%",
        maxWidth: "420px",
        padding: "0 24px",
        position: "relative",
        zIndex: 1,
      }}>
        {/* 로고 영역 */}
        <div style={{ textAlign: "center", marginBottom: "40px" }}>
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "64px",
            height: "64px",
            borderRadius: "20px",
            background: "linear-gradient(135deg, #2563eb, #7c3aed)",
            marginBottom: "20px",
            boxShadow: "0 8px 32px rgba(37,99,235,0.4)",
          }}>
            <span style={{ fontSize: "28px" }}>📄</span>
          </div>
          <h1 style={{
            fontSize: "32px",
            fontWeight: 900,
            fontStyle: "italic",
            background: "linear-gradient(135deg, #60a5fa, #a78bfa)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            margin: "0 0 8px",
            letterSpacing: "-0.5px",
          }}>
            REPOT AI
          </h1>
          <p style={{
            color: "#94a3b8",
            fontSize: "15px",
            margin: 0,
            letterSpacing: "0.2px",
          }}>
            AI 문서 작성 및 편집 워크스페이스
          </p>
        </div>

        {/* 카드 */}
        <div style={{
          backgroundColor: "#1e293b",
          borderRadius: "24px",
          padding: "40px 36px",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.4)",
        }}>
          <h2 style={{
            fontSize: "22px",
            fontWeight: 800,
            color: "#f1f5f9",
            margin: "0 0 8px",
            textAlign: "center",
          }}>
            시작하기
          </h2>
          <p style={{
            color: "#64748b",
            fontSize: "14px",
            textAlign: "center",
            margin: "0 0 32px",
          }}>
            Google 계정으로 빠르게 로그인하세요
          </p>

          <button
            onClick={handleGoogleLogin}
            disabled={isCompletingLogin}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "12px",
              padding: "15px 24px",
              backgroundColor: isCompletingLogin ? "#334155" : "#ffffff",
              border: "none",
              borderRadius: "14px",
              fontSize: "15px",
              fontWeight: 700,
              color: isCompletingLogin ? "#94a3b8" : "#111827",
              cursor: isCompletingLogin ? "not-allowed" : "pointer",
              transition: "all 0.2s ease",
              boxShadow: isCompletingLogin ? "none" : "0 4px 16px rgba(0,0,0,0.2)",
            }}
            onMouseEnter={(e) => {
              if (!isCompletingLogin) {
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.3)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.2)";
            }}
          >
            {isCompletingLogin ? (
              <>
                <div style={{
                  width: "20px",
                  height: "20px",
                  border: "2px solid #475569",
                  borderTop: "2px solid #94a3b8",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                }} />
                로그인 처리 중...
              </>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                Google로 로그인
              </>
            )}
          </button>

          <div style={{
            marginTop: "24px",
            padding: "16px",
            backgroundColor: "rgba(37,99,235,0.08)",
            borderRadius: "12px",
            border: "1px solid rgba(37,99,235,0.15)",
          }}>
            <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
              <span style={{ fontSize: "16px", marginTop: "1px" }}>✨</span>
              <div>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#93c5fd", marginBottom: "4px" }}>
                  무엇을 할 수 있나요?
                </div>
                <div style={{ fontSize: "12px", color: "#64748b", lineHeight: "1.6" }}>
                  DOCX 양식 업로드 → AI 자동 채우기 →<br />
                  실시간 편집 → 다운로드
                </div>
              </div>
            </div>
          </div>
        </div>

        <p style={{
          textAlign: "center",
          marginTop: "24px",
          fontSize: "12px",
          color: "#334155",
        }}>
          로그인하면 서비스 이용약관에 동의하게 됩니다.
        </p>
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}
