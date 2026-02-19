import { NextRequest, NextResponse } from "next/server";
import libre from "libreoffice-convert";
import { promisify } from "util";

const convertAsync = promisify(libre.convert);

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith(".docx") && !fileName.endsWith(".doc")) {
      return NextResponse.json(
        { error: "DOCX 또는 DOC 파일만 지원합니다." },
        { status: 400 }
      );
    }

    // 파일을 Buffer로 변환
    const arrayBuffer = await file.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);

    // LibreOffice로 PDF 변환
    const pdfBuffer = await convertAsync(inputBuffer, ".pdf", undefined);

    // PDF 반환 (Buffer를 Uint8Array로 변환)
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${file.name.replace(/\.(docx?|DOCX?)$/, ".pdf")}"`,
      },
    });
  } catch (error: unknown) {
    console.error("변환 오류:", error);

    // LibreOffice가 없는 경우 친절한 에러 메시지
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (
      errorMessage.includes("LibreOffice") ||
      errorMessage.includes("soffice") ||
      errorMessage.includes("ENOENT")
    ) {
      return NextResponse.json(
        {
          error: "LibreOffice가 설치되어 있지 않습니다.",
          solution:
            "https://www.libreoffice.org/download/download/ 에서 LibreOffice를 설치해주세요.",
          fallback: true,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: "PDF 변환에 실패했습니다.", details: errorMessage },
      { status: 500 }
    );
  }
}
