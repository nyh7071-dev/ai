import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// 저장된 DOCX 파일 제공
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;
    const tmpDir = path.join(process.cwd(), "tmp");
    const filePath = path.join(tmpDir, filename);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "파일을 찾을 수 없습니다" }, { status: 404 });
    }

    const fileBuffer = fs.readFileSync(filePath);

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
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

// 편집된 DOCX 저장
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;
    const tmpDir = path.join(process.cwd(), "tmp");
    const filePath = path.join(tmpDir, filename);

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
