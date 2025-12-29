"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation"; // 'next/navigation'인지 확인!

export default function MainUploadPage() {
  const router = useRouter();
  const [selectedName, setSelectedName] = useState("레포트");
  const [selectedPdf, setSelectedPdf] = useState("/templates/report.pdf");

  const categories = [
    { name: "레포트", icon: "📄", file: "/templates/report.pdf" },
    { name: "실험보고서", icon: "🧪", file: "/templates/lab_report.pdf" },
    { name: "논문", icon: "🎓", file: "/templates/thesis.pdf" },
    { name: "강의노트", icon: "📝", file: "/templates/lecture_note.pdf" },
    { name: "문헌고찰", icon: "📚", file: "/templates/review.pdf" },
    { name: "내 양식 업로드", icon: "➕", file: "custom" },
  ];

  const handleCardClick = (cat: any) => {
    setSelectedName(cat.name);
    if (cat.file !== "custom") {
      setSelectedPdf(cat.file);
    }
  };

  // [분석 시작하기] 버튼 클릭 시 실행
  const handleStartAnalysis = () => {
    // 선택한 양식 이름을 주소 뒤에 붙여서(Query) 작업실로 이동합니다.
    router.push(`/project/new/result?type=${selectedName}`);
  };

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden font-sans">
      {/* 왼쪽 사이드바 */}
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col p-6 z-10">
        <div className="flex items-center gap-2 mb-10 text-blue-600 font-black italic text-xl">REPOT AI</div>
        <nav className="flex-1 space-y-4">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl font-bold">📂 문서</div>
          <div className="p-3 text-gray-400 hover:bg-gray-100 rounded-xl cursor-pointer">💬 ChatGPT</div>
        </nav>
      </div>

      {/* 메인 영역 */}
      <main className="flex-1 p-8 flex flex-col">
        <h1 className="text-2xl font-bold mb-6 text-gray-800">문서 종류 선택</h1>
        <div className="flex gap-8 h-full">
          {/* 카드 목록 */}
          <div className="w-[450px] grid grid-cols-2 gap-4 h-fit">
            {categories.map((cat) => (
              <div
                key={cat.name}
                onClick={() => handleCardClick(cat)}
                className={`h-36 border-2 rounded-3xl flex flex-col items-center justify-center transition-all cursor-pointer ${
                  selectedName === cat.name ? "border-blue-500 bg-white shadow-lg" : "border-gray-200 bg-white"
                }`}
              >
                <span className="text-3xl mb-2">{cat.icon}</span>
                <span className="font-bold text-gray-600">{cat.name}</span>
              </div>
            ))}

            {/* 드디어 분석 시작 버튼! */}
            <button
              onClick={handleStartAnalysis}
              className="col-span-2 mt-4 py-5 bg-blue-600 text-white rounded-2xl font-bold text-xl hover:bg-blue-700 shadow-xl transition-all"
            >
              이 양식으로 분석 시작하기
            </button>
          </div>

          {/* PDF 미리보기 */}
          <div className="flex-1 bg-white rounded-[32px] overflow-hidden border border-gray-200 shadow-2xl">
            <iframe src={`${selectedPdf}#toolbar=0`} className="w-full h-full" title="PDF Preview" />
          </div>
        </div>
      </main>
    </div>
  );
}
