import { createFileAccessToken } from "@/lib/server/fileAccessToken";
import { validateProductionEnv } from "@/lib/server/runtimeConfig";
import { saveUploadedFile } from "@/lib/server/uploadStore";

export const runtime = "nodejs";

export async function POST(request: Request) {
  validateProductionEnv();
  const formData = await request.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return new Response(JSON.stringify({ error: "file is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const saved = await saveUploadedFile(buffer, file.name);
  const accessToken = createFileAccessToken(saved.fileId);

  const baseUrl =
    process.env.FILE_PUBLIC_BASE_URL ||
    request.headers.get("origin") ||
    "http://localhost:3000";

  return new Response(
    JSON.stringify({
      fileId: saved.fileId,
      fileName: saved.fileName,
      storageKey: saved.storageKey,
      accessToken,
      url: `${baseUrl}/api/onlyoffice/file/${saved.fileId}?token=${encodeURIComponent(accessToken)}`,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
