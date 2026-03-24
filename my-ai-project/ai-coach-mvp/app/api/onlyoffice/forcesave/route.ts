import { verifyFileAccessToken } from "@/lib/server/fileAccessToken";

export const runtime = "nodejs";

const ONLYOFFICE_URL =
  process.env.ONLYOFFICE_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_ONLYOFFICE_URL ||
  "http://localhost:8080";

export async function POST(request: Request) {
  const { fileId, accessToken, documentKey } = (await request.json()) as {
    fileId: string;
    accessToken: string;
    documentKey: string;
  };

  if (!fileId || !accessToken || !documentKey) {
    return Response.json({ error: "missing params" }, { status: 400 });
  }

  if (!verifyFileAccessToken(accessToken, fileId)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // OnlyOffice Command Service에 forceSave 요청
  const commandUrl = `${ONLYOFFICE_URL}/coauthoring/CommandService.ashx`;
  const res = await fetch(commandUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ c: "forcesave", key: documentKey }),
  });

  if (!res.ok) {
    return Response.json({ error: "command service failed" }, { status: 502 });
  }

  const result = (await res.json()) as { error: number };

  // error: 0 = 성공, error: 4 = 변경사항 없음 (둘 다 정상)
  if (result.error !== 0 && result.error !== 4) {
    return Response.json({ error: result.error }, { status: 500 });
  }

  return Response.json({ ok: true });
}
