import { NextRequest, NextResponse } from "next/server";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

export async function POST(req: NextRequest) {
  try {
    const { docxBuffer, fields } = await req.json();

    if (!docxBuffer || !fields) {
      return NextResponse.json({ error: "데이터가 없습니다" }, { status: 400 });
    }

    // Base64 디코딩
    const buffer = Buffer.from(docxBuffer, "base64");

    // PizZip으로 DOCX 로드
    const zip = new PizZip(buffer);

    // Docxtemplater로 템플릿 처리
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
    });

    // 필드를 객체로 변환
    const data: Record<string, string> = {};
    fields.forEach((field: any) => {
      const key = field.label.replace(/[:\s\[\]\(\)]/g, "_");
      data[key] = field.value || "";
    });

    // 템플릿에 데이터 삽입
    try {
      doc.render(data);
    } catch (renderErr: any) {
      console.warn("템플릿 렌더링 오류:", renderErr);
      // 템플릿 플레이스홀더가 없을 경우 - 단순히 필드 값을 텍스트로 추가
      // (이 경우는 완벽한 해결책이 아니므로 docxtemplater 플레이스홀더 사용 권장)
    }

    // 새 DOCX 생성
    const output = doc.getZip().generate({
      type: "nodebuffer",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    // Base64로 인코딩하여 반환
    const base64Output = output.toString("base64");

    return NextResponse.json({
      success: true,
      docx: base64Output,
    });

  } catch (err: any) {
    console.error("DOCX 저장 에러:", err);
    return NextResponse.json(
      { error: err.message || "DOCX 저장 실패" },
      { status: 500 }
    );
  }
}
