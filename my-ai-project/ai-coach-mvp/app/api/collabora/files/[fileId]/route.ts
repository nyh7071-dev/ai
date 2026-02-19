import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// Collabora가 파일을 가져가는 엔드포인트 (WOPI protocol)
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
    const stats = fs.statSync(filePath);

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Length": stats.size.toString(),
      },
    });

  } catch (err: any) {
    console.error("파일 제공 에러:", err);
    return NextResponse.json(
      { error: err.message || "서버 에러" },
      { status: 500 }
    );
  }
}

// Collabora가 편집된 파일을 저장하는 엔드포인트 (WOPI protocol)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId } = await params;
    const uploadsDir = path.join(process.cwd(), "uploads");
    const filePath = path.join(uploadsDir, fileId);

    const arrayBuffer = await req.arrayBuffer();
    fs.writeFileSync(filePath, Buffer.from(arrayBuffer));

    return NextResponse.json({ success: true });

  } catch (err: any) {
    console.error("파일 저장 에러:", err);
    return NextResponse.json(
      { error: err.message || "서버 에러" },
      { status: 500 }
    );
  }
}
