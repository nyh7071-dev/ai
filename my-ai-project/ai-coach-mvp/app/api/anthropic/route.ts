import { NextRequest, NextResponse } from "next/server";
import { getRequiredEnv, validateProductionEnv } from "@/lib/server/runtimeConfig";

export const runtime = "nodejs";

const ALLOW_ORIGIN = "http://localhost:8080"; // ONLYOFFICE 오리진(개발용)

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  try {
    validateProductionEnv();
    const apiKey = getRequiredEnv("ANTHROPIC_API_KEY");

    const { prompt, selection, model, max_tokens } = await req.json();

    const body = {
      model: model ?? "claude-sonnet-4-6",
      max_tokens: typeof max_tokens === "number" ? max_tokens : 200,
      messages: [
        {
          role: "user",
          content: `User prompt: ${prompt ?? ""}\n\nSelected text:\n${selection ?? ""}`,
        },
      ],
    };

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const detail = await r.text();
      return NextResponse.json(
        { error: "Anthropic API error", status: r.status, detail },
        { status: 502, headers: corsHeaders }
      );
    }

    const data: any = await r.json();
    const text = data?.content?.[0]?.text ?? "";

    return NextResponse.json({ text }, { headers: corsHeaders });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "unknown error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
