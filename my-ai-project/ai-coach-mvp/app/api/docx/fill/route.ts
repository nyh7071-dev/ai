import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const templateFile = formData.get("template") as File | null;
    const valuesJson = formData.get("values") as string | null;

    if (!templateFile) {
      return NextResponse.json({ ok: false, error: "No template file provided" }, { status: 400 });
    }

    if (!valuesJson) {
      return NextResponse.json({ ok: false, error: "No values provided" }, { status: 400 });
    }

    let values: Record<string, string>;
    try {
      values = JSON.parse(valuesJson);
    } catch (e) {
      return NextResponse.json({ ok: false, error: "Invalid JSON in values" }, { status: 400 });
    }

    // Read template file
    const templateBuffer = Buffer.from(await templateFile.arrayBuffer());

    // Load template with PizZip
    const zip = new PizZip(templateBuffer);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
    });

    // Fill template with values
    doc.render(values);

    // Generate filled DOCX
    const filledBuffer = doc.getZip().generate({
      type: "nodebuffer",
      compression: "DEFLATE",
    });

    // Save to public/filled/ directory
    const timestamp = Date.now();
    const fileName = `filled_${timestamp}.docx`;
    const filledDir = path.join(process.cwd(), "public", "filled");

    // Create directory if it doesn't exist
    if (!fs.existsSync(filledDir)) {
      fs.mkdirSync(filledDir, { recursive: true });
    }

    const filePath = path.join(filledDir, fileName);
    fs.writeFileSync(filePath, filledBuffer);

    // Generate file URL accessible by DocumentServer
    const fileUrl = `http://host.docker.internal:3000/filled/${fileName}`;
    const documentKey = `filled_${timestamp}`;

    return NextResponse.json({
      ok: true,
      fileUrl,
      key: documentKey,
      fileName,
    });
  } catch (error: any) {
    console.error("[DOCX Fill] Error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to fill document" },
      { status: 500 }
    );
  }
}
