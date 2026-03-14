// app/api/generate/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getRequiredEnv, validateProductionEnv } from "@/lib/server/runtimeConfig";

const openai = new OpenAI({
  apiKey: getRequiredEnv("OPENAI_API_KEY"),
});

export async function POST(req: Request) {
  try {
    validateProductionEnv();
    const { prompt, type, history, docContext, hasSlots } = await req.json();
    if (!prompt || !type) {
      return NextResponse.json({ error: "요청 데이터가 올바르지 않습니다." }, { status: 400 });
    }

    // 이전 대화 히스토리 (최근 10개까지)
    const historyMsgs: { role: "user" | "assistant"; content: string }[] = [];
    if (Array.isArray(history)) {
      const recent = history.slice(-10);
      for (const m of recent) {
        if (m.role === "user") historyMsgs.push({ role: "user", content: m.text });
        else if (m.role === "ai") historyMsgs.push({ role: "assistant", content: m.text });
      }
    }

    // 시스템 프롬프트
    let systemContent = `당신은 REPOT AI 어시스턴트입니다. ${type} 작성을 도와주는 전문 AI 조교이며, 사용자의 일반적인 질문에도 친절하고 정확하게 답변합니다. 한국어로 답변하세요.`;

    if (docContext) {
      systemContent += `\n\n${docContext}`;
    }

    // 슬롯이 있는 문서 작업 중 → JSON 모드로 의도 판단
    if (hasSlots) {
      systemContent += `\n\n## 반드시 JSON으로만 응답하세요.
사용자의 메시지를 분석하여 의도를 판단하고, 아래 형식의 JSON으로만 응답하세요.

질문/대화인 경우 (정보 요청, 궁금한 점, 설명 요청 등):
{"action":"answer","text":"답변 내용"}

문서 수정 요청인 경우 (채워줘, 바꿔줘, 수정해줘, 다시 써줘, 더 자세하게 등):
{"action":"modify","text":"수정 요청을 확인하는 짧은 메시지"}

예시:
- "왜 안채워져있어?" → {"action":"answer","text":"빈 슬롯이 남아있는 이유는..."}
- "제목 바꿔줘" → {"action":"modify","text":"제목 부분을 수정하겠습니다."}
- "레포트 잘 쓰는 법" → {"action":"answer","text":"레포트 작성 팁을 알려드리겠습니다..."}
- "빈칸 다 채워" → {"action":"modify","text":"빈 슬롯을 모두 채우겠습니다."}`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 4000,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemContent },
          ...historyMsgs,
          { role: "user", content: prompt },
        ],
      });

      const raw = completion.choices[0].message.content || "{}";
      try {
        const parsed = JSON.parse(raw) as { action?: string; text?: string };
        return NextResponse.json({
          result: parsed.text || "",
          action: parsed.action === "modify" ? "modify" : "answer",
        });
      } catch {
        // JSON 파싱 실패 시 일반 답변으로 처리
        return NextResponse.json({ result: raw, action: "answer" });
      }
    }

    // 슬롯 없음 → 일반 대화 모드
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 4000,
      temperature: 0.7,
      messages: [
        { role: "system", content: systemContent },
        ...historyMsgs,
        { role: "user", content: prompt },
      ],
    });

    return NextResponse.json({
      result: completion.choices[0].message.content || "",
      action: "answer",
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "AI 연결 실패" }, { status: 500 });
  }
}
