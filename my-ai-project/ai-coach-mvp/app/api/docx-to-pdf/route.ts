import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
  let docxPath = "";
  let pdfPath = "";

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

    // DOCX 파일 저장
    docxPath = path.join(tmpDir, `${Date.now()}_input.docx`);
    const arrayBuffer = await file.arrayBuffer();
    fs.writeFileSync(docxPath, Buffer.from(arrayBuffer));

    // PDF 출력 경로
    pdfPath = docxPath.replace(".docx", ".pdf");

    try {
      // Windows 경로를 WSL 경로로 변환 (Windows에서 Docker 사용 시)
      let dockerVolumePath = tmpDir;
      if (process.platform === "win32") {
        // C:\Users\... → /c/Users/...
        dockerVolumePath = tmpDir.replace(/\\/g, "/").replace(/^([A-Z]):/, (match, drive) => `/${drive.toLowerCase()}`);
      }

      // Docker로 LibreOffice 실행 (DOCX → PDF 변환)
      const cmd = `docker run --rm -v "${dockerVolumePath}:/workspace" -w /workspace linuxserver/libreoffice:latest libreoffice --headless --convert-to pdf --outdir /workspace "${path.basename(docxPath)}"`;

      console.log("실행 명령:", cmd);
      console.log("임시 디렉토리:", tmpDir);
      console.log("Docker 볼륨 경로:", dockerVolumePath);

      const { stdout, stderr } = await execAsync(cmd, { timeout: 60000 });

      console.log("stdout:", stdout);
      if (stderr) console.log("stderr:", stderr);

      // PDF 파일 읽기
      if (!fs.existsSync(pdfPath)) {
        console.error("PDF 파일이 생성되지 않음:", pdfPath);
        throw new Error(`PDF 파일 생성 실패. 출력: ${stdout}`);
      }

      const pdfBuffer = fs.readFileSync(pdfPath);

      // 임시 파일 삭제
      try {
        fs.unlinkSync(docxPath);
        fs.unlinkSync(pdfPath);
      } catch (cleanupErr) {
        console.warn("임시 파일 정리 실패:", cleanupErr);
      }

      // PDF 반환 (RFC 5987 인코딩으로 한글 파일명 지원)
      const pdfFileName = file.name.replace('.docx', '.pdf');
      const encodedFileName = encodeURIComponent(pdfFileName);

      return new NextResponse(pdfBuffer, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="output.pdf"; filename*=UTF-8''${encodedFileName}`,
        },
      });

    } catch (err: any) {
      console.error("Docker 변환 실패:", err);
      console.error("에러 상세:", err.message);

      // 폴백: libreoffice-convert 라이브러리 사용 (Docker 없이도 작동)
      try {
        const libre = require("libreoffice-convert");
        const convert = promisify(libre.convert);

        const docxBuffer = fs.readFileSync(docxPath);
        const pdfBuffer = await convert(docxBuffer, ".pdf", undefined);

        // 임시 파일 삭제
        fs.unlinkSync(docxPath);

        // RFC 5987 인코딩으로 한글 파일명 지원
        const pdfFileName = file.name.replace('.docx', '.pdf');
        const encodedFileName = encodeURIComponent(pdfFileName);

        return new NextResponse(pdfBuffer, {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="output.pdf"; filename*=UTF-8''${encodedFileName}`,
          },
        });

      } catch (fallbackErr) {
        console.error("폴백 변환 실패:", fallbackErr);
        throw new Error("DOCX → PDF 변환 실패");
      }
    }

  } catch (err: any) {
    console.error("API 에러:", err);

    // 임시 파일 정리
    try {
      if (fs.existsSync(docxPath)) fs.unlinkSync(docxPath);
      if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
    } catch (cleanupErr) {
      console.warn("정리 실패:", cleanupErr);
    }

    return NextResponse.json(
      {
        error: err.message || "서버 에러",
        details: err.stack,
        platform: process.platform,
      },
      { status: 500 }
    );
  }
}
