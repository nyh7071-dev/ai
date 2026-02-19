import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// DOCX 파일을 저장하고 URL 반환
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "파일이 없습니다" }, { status: 400 });
    }

    // 임시 디렉토리 생성
    const tmpDir = path.join(process.cwd(), "tmp");
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    // DOCX 파일 저장 (타임스탬프로 고유 파일명)
    const timestamp = Date.now();
    const docxPath = path.join(tmpDir, `${timestamp}_${file.name}`);
    const arrayBuffer = await file.arrayBuffer();
    fs.writeFileSync(docxPath, Buffer.from(arrayBuffer));

    // 파일 URL 반환 (OnlyOffice에서 접근 가능하도록)
    const fileUrl = `/api/docx-file/${timestamp}_${file.name}`;

    return NextResponse.json({
      success: true,
      fileUrl,
      fileName: file.name,
      timestamp,
    });

  } catch (err: any) {
    console.error("DOCX 서빙 에러:", err);
    return NextResponse.json(
      { error: err.message || "서버 에러" },
      { status: 500 }
    );
  }
}
