import { fillDocx, type FillOp } from "@/lib/docx/fillDocx";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("template");
    const opsJson = formData.get("ops");

    if (!file || !(file instanceof File)) {
      return new Response(
        JSON.stringify({ error: "template (DOCX file) is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    if (!opsJson || typeof opsJson !== "string") {
      return new Response(
        JSON.stringify({ error: "ops (JSON string) is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    let ops: FillOp[];
    try {
      ops = JSON.parse(opsJson);
    } catch {
      return new Response(
        JSON.stringify({ error: "ops JSON 파싱 실패" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const templateBuffer = await file.arrayBuffer();
    const filledBuffer = await fillDocx(templateBuffer, ops);

    return new Response(filledBuffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": 'attachment; filename="filled.docx"',
      },
    });
  } catch (err) {
    console.error("[docx/fill-ops]", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
