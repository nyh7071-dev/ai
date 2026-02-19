// POST /api/realtime/user-edit
// Handle user edits from OnlyOffice plugin

import { NextRequest, NextResponse } from "next/server";

// CORS 헤더
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// OPTIONS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { documentKey, slot, newValue } = body;

    if (!documentKey) {
      return NextResponse.json(
        { error: "documentKey is required" },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!slot) {
      return NextResponse.json(
        { error: "slot is required" },
        { status: 400, headers: corsHeaders }
      );
    }

    // Log the user edit
    console.log(`[User Edit] Document: ${documentKey}, Slot: ${slot}, Value: ${newValue}`);

    // TODO: Store the edit in a database or session state
    // This can be used for:
    // 1. Tracking which slots the user has manually edited
    // 2. Preventing AI from overwriting user-edited slots
    // 3. Learning user preferences for future suggestions

    return NextResponse.json(
      {
        success: true,
        documentKey,
        slot,
        newValue,
      },
      { headers: corsHeaders }
    );
  } catch (error: any) {
    console.error("User edit error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process user edit" },
      { status: 500, headers: corsHeaders }
    );
  }
}
