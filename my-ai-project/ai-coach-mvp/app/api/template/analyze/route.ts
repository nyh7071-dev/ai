// POST /api/template/analyze
// Analyze DOCX template and return IR + ClassifiedIR

import { NextRequest, NextResponse } from "next/server";
import { parseDocxToIR, classifyIR } from "@/lib/template-engine";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json(
        { error: "파일이 없습니다" },
        { status: 400 }
      );
    }

    if (!file.name.endsWith(".docx")) {
      return NextResponse.json(
        { error: "DOCX 파일만 지원합니다" },
        { status: 400 }
      );
    }

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Parse DOCX to IR
    const ir = await parseDocxToIR(buffer);

    // Classify IR
    const classifiedIR = await classifyIR(ir, openai);

    return NextResponse.json({
      success: true,
      ir,
      classifiedIR,
      fileName: file.name,
    });
  } catch (error: any) {
    console.error("Template analysis error:", error);
    return NextResponse.json(
      { error: error.message || "템플릿 분석 실패" },
      { status: 500 }
    );
  }
}
