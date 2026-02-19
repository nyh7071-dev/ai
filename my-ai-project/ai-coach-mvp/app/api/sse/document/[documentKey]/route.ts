// Server-Sent Events endpoint for real-time document updates

import { NextRequest } from "next/server";

// Store active connections per document
const connections = new Map<string, Set<ReadableStreamDefaultController>>();

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ documentKey: string }> }
) {
  const { documentKey } = await params;

  // Create SSE stream
  const stream = new ReadableStream({
    start(controller) {
      // Add this connection to the document's connection set
      if (!connections.has(documentKey)) {
        connections.set(documentKey, new Set());
      }
      connections.get(documentKey)!.add(controller);

      // Send initial connection message
      const encoder = new TextEncoder();
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "connected", documentKey })}\n\n`
        )
      );

      // Keep-alive ping every 30 seconds
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keep-alive\n\n`));
        } catch (error) {
          clearInterval(keepAlive);
        }
      }, 30000);

      // Cleanup on close
      req.signal.addEventListener("abort", () => {
        clearInterval(keepAlive);
        connections.get(documentKey)?.delete(controller);
        if (connections.get(documentKey)?.size === 0) {
          connections.delete(documentKey);
        }
        try {
          controller.close();
        } catch (e) {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "X-Accel-Buffering": "no", // Disable proxy buffering (Nginx)
    },
  });
}

// OPTIONS preflight for CORS
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

// Helper function to broadcast patches to all connected clients
export function broadcastPatch(documentKey: string, patch: any) {
  const documentConnections = connections.get(documentKey);
  if (!documentConnections) return;

  const encoder = new TextEncoder();
  const data = `data: ${JSON.stringify(patch)}\n\n`;

  documentConnections.forEach((controller) => {
    try {
      controller.enqueue(encoder.encode(data));
    } catch (error) {
      console.error("Error broadcasting to client:", error);
      documentConnections.delete(controller);
    }
  });
}
