"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

export default function MainUploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedName, setSelectedName] = useState("레포트");
  const [selectedPdf, setSelectedPdf] = useState("/templates/report.pdf");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

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
    if (cat.file === "custom") {
      fileInputRef.current?.click();
    } else {
      setSelectedPdf(cat.file);
      setUploadedFile(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === "application/pdf") {
      setUploadedFile(file);
      setSelectedPdf(URL.createObjectURL(file));
      setSelectedName(file.name.replace(/\.pdf$/, ''));
    }
  };

  return (
    <div style={{ display: "flex", height: "100vh", backgroundColor: "#f3f4f6", overflow: "hidden" }}>
      <aside style={{ width: "260px", backgroundColor: "white", borderRight: "1px solid #e5e7eb", display: "flex", flexDirection: "column", padding: "30px 20px" }}>
        <div style={{ color: "#2563eb", fontWeight: "900", fontStyle: "italic", fontSize: "22px", marginBottom: "40px" }}>REPOT AI</div>
        <nav style={{ flex: 1 }}>
          <div style={{ padding: "12px 16px", backgroundColor: "#eff6ff", color: "#2563eb", borderRadius: "12px", fontWeight: "bold" }}>📂 문서</div>
        </nav>
      </aside>

      <main style={{ flex: 1, padding: "20px 40px", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <h2 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "20px" }}>문서 종류 선택</h2>
        <div style={{ display: "flex", gap: "25px", flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, backgroundColor: "white", padding: "25px", borderRadius: "32px", border: "1px solid #e5e7eb", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "15px", overflowY: "auto", flex: 1 }}>
              {categories.map((cat) => (
                <div key={cat.name} onClick={() => handleCardClick(cat)} style={{ height: "130px", borderRadius: "24px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", border: selectedName === cat.name ? "2px solid #2563eb" : "1px solid #f3f4f6", backgroundColor: selectedName === cat.name ? "white" : "#f9fafb" }}>
                  <span style={{ fontSize: "36px" }}>{cat.icon}</span>
                  <span style={{ fontWeight: "bold" }}>{cat.name}</span>
                </div>
              ))}
            </div>
            <input type="file" ref={fileInputRef} style={{ display: "none" }} accept="application/pdf" onChange={handleFileChange} />
            <button onClick={() => router.push(`/project/new/result?type=${selectedName}`)} style={{ width: "100%", padding: "20px", backgroundColor: "#2563eb", color: "white", borderRadius: "20px", fontSize: "18px", fontWeight: "bold", marginTop: "20px" }}>
              이 양식으로 분석 시작하기
            </button>
          </div>

          <div style={{ flex: 1, backgroundColor: "white", borderRadius: "32px", border: "1px solid #e5e7eb", padding: "8px", display: "flex", flexDirection: "column" }}>
            <div style={{ flex: 1, backgroundColor: "#f3f4f6", borderRadius: "26px", overflow: "hidden" }}>
              <iframe key={selectedPdf} src={`${selectedPdf}#toolbar=0&view=FitH`} style={{ width: "100%", height: "100%", border: "none" }} />
            </div>
            <div style={{ padding: "10px 0", textAlign: "center" }}>
              <span style={{ color: "#2563eb", fontWeight: "bold" }}>미리보기: {selectedName}</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}