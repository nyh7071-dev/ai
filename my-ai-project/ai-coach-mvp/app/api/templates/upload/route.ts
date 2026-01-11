import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

export async function POST(request: Request) {
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
  const safeName = file.name.replace(/\s+/g, "_");
  const fileName = `${Date.now()}_${randomUUID()}_${safeName}`;
  const uploadDir = join(process.cwd(), "public", "uploads");
  await mkdir(uploadDir, { recursive: true });
  const filePath = join(uploadDir, fileName);
  await writeFile(filePath, buffer);

  const baseUrl =
    process.env.FILE_PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_FILE_BASE_URL ||
    request.headers.get("origin") ||
    "";
  const publicUrl = baseUrl ? `${baseUrl}/uploads/${fileName}` : `/uploads/${fileName}`;
  const origin = request.headers.get("origin") || "";
  const publicUrl = origin ? `${origin}/uploads/${fileName}` : `/uploads/${fileName}`;

  return new Response(JSON.stringify({ publicUrl }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
