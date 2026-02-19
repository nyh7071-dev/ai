import { NextRequest, NextResponse } from "next/server";
import { Document, Packer, Paragraph, TextRun } from "docx";

// HTML을 DOCX로 변환
export async function POST(req: NextRequest) {
  try {
    const { html, fileName } = await req.json();

    if (!html) {
      return NextResponse.json({ error: "HTML 내용이 없습니다" }, { status: 400 });
    }

    // 간단한 HTML 파싱 (실제로는 더 복잡한 변환 필요)
    // HTML 태그 제거하고 텍스트만 추출
    const textContent = html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');

    // DOCX 문서 생성
    const doc = new Document({
      sections: [{
        properties: {},
        children: textContent.split('\n').map((line: string) =>
          new Paragraph({
            children: [
              new TextRun({
                text: line || " ",
                font: "Malgun Gothic",
                size: 22, // 11pt
              }),
            ],
          })
        ),
      }],
    });

    // DOCX 버퍼 생성
    const buffer = await Packer.toBuffer(doc);

    // Base64로 인코딩하여 반환
    const base64 = buffer.toString('base64');

    return NextResponse.json({
      success: true,
      docx: base64,
      fileName: fileName || "edited.docx",
    });

  } catch (err: any) {
    console.error("HTML → DOCX 변환 에러:", err);
    return NextResponse.json(
      { error: err.message || "변환 실패" },
      { status: 500 }
    );
  }
}
