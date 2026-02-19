import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// WOPI CheckFileInfo - Collabora가 파일 정보를 요청
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

    const stats = fs.statSync(filePath);
    const fileName = fileId.split("_").slice(1).join("_"); // timestamp 제거

    // WOPI CheckFileInfo response
    return NextResponse.json({
      BaseFileName: fileName,
      Size: stats.size,
      UserId: "user1",
      UserFriendlyName: "User",
      UserCanWrite: true,
      UserCanNotWriteRelative: false,
      PostMessageOrigin: "*",
      EnableOwnerTermination: true,
    });

  } catch (err: any) {
    console.error("CheckFileInfo 에러:", err);
    return NextResponse.json(
      { error: err.message || "서버 에러" },
      { status: 500 }
    );
  }
}
