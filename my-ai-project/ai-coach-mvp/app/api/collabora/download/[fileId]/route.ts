import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// 편집된 DOCX 파일 다운로드
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId } = await params;
    const uploadsDir = path.join(process.cwd(), "uploads");
    const filePath = path.join(uploadsDir, fileId);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "파일을 찾을 수 없습니다" }, { status: 404 });
    }

    const fileBuffer = fs.readFileSync(filePath);
    const fileName = fileId.split("_").slice(1).join("_"); // timestamp 제거

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });

  } catch (err: any) {
    console.error("다운로드 에러:", err);
    return NextResponse.json(
      { error: err.message || "서버 에러" },
      { status: 500 }
    );
  }
}
