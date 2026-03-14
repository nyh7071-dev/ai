"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
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

      router.replace("/");
      router.refresh();
    })();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  const handleGoogleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        backgroundColor: "#f4f4f5",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          width: "400px",
          backgroundColor: "#ffffff",
          borderRadius: "24px",
          padding: "48px 40px",
          boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
          border: "1px solid #e4e4e7",
          textAlign: "center",
        }}
      >
        <div
          style={{
            color: "#2563eb",
            fontWeight: "900",
            fontStyle: "italic",
            fontSize: "32px",
            marginBottom: "8px",
          }}
        >
          REPOT AI
        </div>
        <p
          style={{
            color: "#71717a",
            fontSize: "14px",
            marginBottom: "40px",
          }}
        >
          AI 문서 작성 및 편집 워크스페이스
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
            padding: "14px 24px",
            backgroundColor: "#ffffff",
            border: "1.5px solid #e4e4e7",
            borderRadius: "12px",
            fontSize: "15px",
            fontWeight: "600",
            color: "#18181b",
            cursor: isCompletingLogin ? "not-allowed" : "pointer",
            opacity: isCompletingLogin ? 0.7 : 1,
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => {
            if (!isCompletingLogin) {
              e.currentTarget.style.backgroundColor = "#fafafa";
              e.currentTarget.style.borderColor = "#d4d4d8";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "#ffffff";
            e.currentTarget.style.borderColor = "#e4e4e7";
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          {isCompletingLogin ? "로그인 처리 중..." : "Google로 로그인"}
        </button>

        <p
          style={{
            marginTop: "32px",
            fontSize: "11px",
            color: "#a1a1aa",
          }}
        >
          로그인하면 서비스 이용약관에 동의하게 됩니다.
        </p>
      </div>
    </div>
  );
}
