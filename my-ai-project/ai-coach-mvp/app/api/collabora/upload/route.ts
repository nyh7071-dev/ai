import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// Collabora용 DOCX 파일 업로드
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "파일이 없습니다" }, { status: 400 });
    }

    // 파일 저장 디렉토리
    const uploadsDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // 고유 파일명 생성
    const fileId = `${Date.now()}_${file.name}`;
    const filePath = path.join(uploadsDir, fileId);

    // 파일 저장
    const arrayBuffer = await file.arrayBuffer();
    fs.writeFileSync(filePath, Buffer.from(arrayBuffer));

    // Collabora에서 접근할 수 있는 URL 생성
    const fileUrl = `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/collabora/files/${fileId}`;

    return NextResponse.json({
      success: true,
      fileId,
      fileUrl,
      fileName: file.name,
    });

  } catch (err: any) {
    console.error("파일 업로드 에러:", err);
    return NextResponse.json(
      { error: err.message || "업로드 실패" },
      { status: 500 }
    );
  }
}
