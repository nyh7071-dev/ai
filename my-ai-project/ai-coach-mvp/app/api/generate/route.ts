// app/api/generate/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";

// API 키 설정 (환경 변수에서 가져옵니다)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { prompt, type } = await req.json();
    if (!prompt || !type) {
      return NextResponse.json({ error: "요청 데이터가 올바르지 않습니다." }, { status: 400 });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // 또는 gpt-3.5-turbo
      messages: [
        { role: "system", content: `당신은 ${type} 작성을 도와주는 전문 AI 조교입니다. 학술적이고 논리정연하게 답변하세요.` },
        { role: "user", content: prompt },
      ],
    });

    return NextResponse.json({ result: completion.choices[0].message.content });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "AI 연결 실패" }, { status: 500 });
  }
}
