import { basename } from "node:path";
import { verifyFileAccessToken } from "@/lib/server/fileAccessToken";
import { validateProductionEnv } from "@/lib/server/runtimeConfig";
import { readUploadedFile, saveUploadedFile } from "@/lib/server/uploadStore";

export const runtime = "nodejs";

type OnlyOfficeCallbackPayload = {
  status?: number;
  url?: string;
  key?: string;
};

export async function POST(request: Request) {
  validateProductionEnv();
  const { searchParams } = new URL(request.url);
  const fileParam = searchParams.get("fileId");
  const token = searchParams.get("token") || "";
  const safeFileId = fileParam ? basename(fileParam) : "";

  if (!safeFileId) {
    return new Response(JSON.stringify({ error: "fileId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!verifyFileAccessToken(token, safeFileId)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = (await request.json()) as OnlyOfficeCallbackPayload;
  const status = payload.status ?? 0;

  if ((status === 2 || status === 6) && payload.url) {
    const res = await fetch(payload.url);
    if (!res.ok) {
      return new Response(JSON.stringify({ error: "download failed" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const current = await readUploadedFile(safeFileId);
    const arrayBuffer = await res.arrayBuffer();
    await saveUploadedFile(
      Buffer.from(arrayBuffer),
      current?.fileName || `${safeFileId}.docx`,
      safeFileId
    );
  }

  return new Response(JSON.stringify({ error: 0 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
