import { type NextRequest } from "next/server";
import { verifyFileAccessToken } from "@/lib/server/fileAccessToken";
import { validateProductionEnv } from "@/lib/server/runtimeConfig";
import { readUploadedFile } from "@/lib/server/uploadStore";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  validateProductionEnv();
  const { fileId } = await params;
  const token = new URL(_request.url).searchParams.get("token") || "";

  if (!verifyFileAccessToken(token, fileId)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const storedFile = await readUploadedFile(fileId);
    if (!storedFile) {
      return new Response(JSON.stringify({ error: "file not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const ext = storedFile.fileName.split(".").pop()?.toLowerCase() || "";
    const contentType =
      ext === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/octet-stream";

    return new Response(storedFile.buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${storedFile.fileName}"`,
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: "file not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
}
