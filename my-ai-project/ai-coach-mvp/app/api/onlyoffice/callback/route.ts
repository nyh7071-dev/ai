import { writeFile } from "node:fs/promises";
import { join, basename } from "node:path";

export const runtime = "nodejs";

type OnlyOfficeCallbackPayload = {
  status?: number;
  url?: string;
  key?: string;
};

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const fileParam = searchParams.get("file");
  const safeFileName = fileParam ? basename(fileParam) : "";

  if (!safeFileName) {
    return new Response(JSON.stringify({ error: "file is required" }), {
      status: 400,
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
    const arrayBuffer = await res.arrayBuffer();
    const filePath = join(process.cwd(), "public", "uploads", safeFileName);
    await writeFile(filePath, Buffer.from(arrayBuffer));
  }

  return new Response(JSON.stringify({ error: 0 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
