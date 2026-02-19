// POST /api/template/fill
// Fill slots in DOCX template and return filled DOCX

import { NextRequest, NextResponse } from "next/server";
import { fillSlots, type SlotValue, type ClassifiedIR } from "@/lib/template-engine";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const slotValuesJson = formData.get("slotValues") as string;
    const classifiedIRJson = formData.get("classifiedIR") as string;

    if (!file) {
      return NextResponse.json(
        { error: "파일이 없습니다" },
        { status: 400 }
      );
    }

    if (!slotValuesJson) {
      return NextResponse.json(
        { error: "슬롯 값이 없습니다" },
        { status: 400 }
      );
    }

    // Parse inputs
    const slotValues: SlotValue[] = JSON.parse(slotValuesJson);
    const classifiedIR: ClassifiedIR = classifiedIRJson
      ? JSON.parse(classifiedIRJson)
      : { nodes: [], metadata: { totalSlots: 0, lowConfidenceNodes: [] } };

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Fill slots
    const filledBuffer = await fillSlots(buffer, slotValues, classifiedIR);

    // Return filled DOCX
    return new NextResponse(new Uint8Array(filledBuffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="filled_${file.name}"`,
      },
    });
  } catch (error: any) {
    console.error("Template fill error:", error);
    return NextResponse.json(
      { error: error.message || "템플릿 채우기 실패" },
      { status: 500 }
    );
  }
}
