"use client";

import { useState } from "react";

export default function UploadPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [status, setStatus] = useState("준비 완료"); // <-- 이게 박스에 들어갈 글자

  const handleUpload = async () => {
    setLoading(true);
    setStatus("📡 AI가 분석을 시작했습니다..."); // 박스 글자 바뀜
    setResult("");
    const subject = "동물질병학";
    const assertion = "레포트 초안";

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `${subject} 과목의 ${assertion}를 작성해 주세요.`,
          type: assertion,
        }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        setStatus(`❌ 에러 발생: ${data.error}`); // 에러나면 박스에 빨간색으로 뜸
        return;
      }

      setResult(data.result);
      setStatus("✅ 분석이 완료되었습니다!");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.";
      setStatus(`❌ 연결 실패: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-6">
      <div className="bg-white p-10 rounded-3xl shadow-xl w-full max-w-lg">
        <h1 className="text-2xl font-bold mb-6 text-center">AI 분석 코치</h1>
        
        {/* 👇 이게 바로 제가 말한 '검은 박스' 코드입니다! */}
        <div className="mb-6 p-4 bg-black text-green-400 font-mono text-center rounded-xl border-4 border-gray-700">
          {status}
        </div>

        <button
          onClick={handleUpload}
          disabled={loading}
          className="w-full py-4 bg-blue-600 text-white rounded-xl font-bold text-lg hover:bg-blue-700 disabled:bg-gray-400"
        >
          {loading ? "분석 중..." : "AI 초안 생성 시작"}
        </button>

        {result && (
          <div className="mt-8 p-6 bg-blue-50 border border-blue-200 rounded-xl text-gray-800">
            <h2 className="font-bold mb-2">✨ AI 분석 결과</h2>
            <div className="whitespace-pre-wrap">{result}</div>
          </div>
        )}
      </div>
    </div>
  );
}
