// WebSocket endpoint for real-time document updates
// Note: Next.js doesn't natively support WebSocket in API routes
// This is a placeholder - we'll need to set up a custom server or use a library

import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ documentKey: string }> }
) {
  const { documentKey } = await params;

  // Check if this is a WebSocket upgrade request
  const upgrade = req.headers.get("upgrade");

  if (upgrade !== "websocket") {
    return NextResponse.json(
      { error: "Expected WebSocket upgrade" },
      { status: 426 }
    );
  }

  // WebSocket handling needs custom server
  // For now, return instruction to use alternative approach
  return NextResponse.json(
    {
      error: "WebSocket not available in this endpoint",
      alternative: "Use Server-Sent Events at /api/sse/document/" + documentKey,
    },
    { status: 501 }
  );
}
