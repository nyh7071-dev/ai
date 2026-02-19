// POST /api/realtime/push
// Push real-time patches to OnlyOffice plugin clients

import { NextRequest, NextResponse } from "next/server";
import { broadcastPatch } from "@/app/api/sse/document/[documentKey]/route";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { documentKey, patch } = body;

    if (!documentKey) {
      return NextResponse.json(
        { error: "documentKey is required" },
        { status: 400 }
      );
    }

    if (!patch) {
      return NextResponse.json(
        { error: "patch is required" },
        { status: 400 }
      );
    }

    // Validate patch structure
    if (!patch.op) {
      return NextResponse.json(
        { error: "patch.op is required" },
        { status: 400 }
      );
    }

    // Broadcast to all connected clients for this document
    broadcastPatch(documentKey, patch);

    return NextResponse.json({
      success: true,
      documentKey,
      patch,
    });
  } catch (error: any) {
    console.error("Push error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to push patch" },
      { status: 500 }
    );
  }
}

// Example patch formats:
// {
//   "op": "setSlotText",
//   "slot": "company_name",
//   "text": "삼성전자 주식회사",
//   "mode": "replace"
// }
//
// {
//   "op": "deleteSlot",
//   "slot": "example_text"
// }
//
// {
//   "op": "replaceText",
//   "search": "홍길동",
//   "replace": "김철수"
// }
//
// {
//   "op": "batchUpdate",
//   "updates": [
//     { "op": "setSlotText", "slot": "name", "text": "김철수" },
//     { "op": "setSlotText", "slot": "company", "text": "삼성전자" }
//   ]
// }
