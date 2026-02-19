// app/api/analyze-form/route.ts
// PDF 양식 분석 및 자동 채우기 API (Docker 불필요)
import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// CORS 헤더 (ONLYOFFICE localhost:8080에서 호출 가능)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// OPTIONS preflight 처리
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}

interface FormField {
  id: string;
  label: string;
  type: "text" | "date" | "number" | "multiline" | "checkbox";
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
  value?: string;
  placeholder?: string;
}

interface AnalyzeRequest {
  action: "analyze" | "fill";
  formText: string;
  sourceText?: string;
  formStructure?: FormField[];
  slots?: Array<{ key: string; label: string; currentValue?: string; context?: string; slotType?: string }>;
}

export async function POST(req: Request) {
  try {
    const body: AnalyzeRequest = await req.json();
    const { action, formText, sourceText, formStructure, slots } = body;

    if (!formText) {
      return NextResponse.json(
        { error: "양식 텍스트가 필요합니다." },
        { status: 400, headers: corsHeaders }
      );
    }

    if (action === "analyze") {
      // 양식 구조 분석
      const prompt = `당신은 PDF 양식 분석 전문가입니다.

아래 양식의 텍스트를 분석하여 입력이 필요한 필드들을 찾아주세요.

## 양식 텍스트:
${formText}

## 작업:
1. 빈칸 (___, [   ], (   ) 등)을 찾으세요
2. 입력 필드명 (이름:, 날짜:, 주소: 등)을 찾으세요
3. 체크박스 (□, ○ 등)를 찾으세요
4. 표의 빈 셀을 찾으세요

## 응답 형식 (JSON):
{
  "fields": [
    {
      "label": "필드명",
      "type": "text|date|number|multiline|checkbox",
      "placeholder": "예시 입력값",
      "context": "해당 필드 주변 텍스트 (위치 파악용)"
    }
  ],
  "formType": "양식 종류 (예: 이력서, 신청서, 보고서 등)",
  "summary": "양식 요약 설명"
}

JSON만 응답하세요.`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "당신은 문서 양식 분석 전문가입니다. 정확한 JSON 형식으로 응답하세요." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      });

      const result = completion.choices[0].message.content;
      try {
        const parsed = JSON.parse(result || "{}");
        return NextResponse.json(parsed, { headers: corsHeaders });
      } catch {
        return NextResponse.json(
          {
            fields: [],
            formType: "알 수 없음",
            summary: "양식 분석에 실패했습니다.",
            raw: result
          },
          { headers: corsHeaders }
        );
      }
    }

    if (action === "fill") {
      // 자료 기반 자동 채우기
      if (!sourceText) {
        return NextResponse.json(
          { error: "참고 자료가 필요합니다." },
          { status: 400, headers: corsHeaders }
        );
      }

      // slots가 제공되면 key 기반 스키마 사용
      const useKeyBasedSchema = slots && slots.length > 0;

      let prompt: string;

      if (useKeyBasedSchema) {
        // KEY 기반 스키마 (slots 정보 있음) - 컨텍스트 포함
        const slotsInfo = slots!.map(s => {
          let info = `- key: "${s.key}" | 라벨: "${s.label}"`;
          if (s.currentValue) {
            // ※로 시작하는 안내문은 "교체 대상"으로 표시
            if (s.currentValue.startsWith('※')) {
              info += ` | [교체 대상 안내문]: "${s.currentValue.substring(0, 60)}"`;
            } else {
              info += ` | [교체 대상 플레이스홀더]: "${s.currentValue.substring(0, 60)}"`;
            }
          }
          if (s.context) info += ` | 위치힌트: "${s.context}"`;
          if (s.slotType) info += ` | 유형: ${s.slotType}`;
          return info;
        }).join("\n");

        prompt = `당신은 창업 계획서 및 사업 제안서 작성 전문가입니다.

## 핵심 규칙:
- "교체 대상 안내문"과 "교체 대상 플레이스홀더"는 **삭제하고 새로운 내용으로 대체**해야 합니다.
- 절대로 ※로 시작하는 안내문, OO, ○○ 같은 플레이스홀더를 그대로 반환하지 마세요.
- 참고 자료를 기반으로 **실제 내용**을 작성하세요.

## 템플릿 슬롯 목록 (${slots!.length}개):
각 슬롯의 "교체 대상"은 현재 양식에 들어있는 예시/안내문이며, 이를 실제 내용으로 교체해야 합니다.

${slotsInfo}

## 참고 자료:
${sourceText}

## 작성 규칙:
1. 참고 자료에서 각 슬롯에 맞는 정보를 추출하여 **새로운 내용**을 작성
2. short_text 유형: 간결하게 (10-50자) - 예: 이름, 직위, 날짜, 금액
3. long_text 유형: 상세하게 (200-800자) - 예: 문제 인식, 실현 가능성, 성장전략
4. ※로 시작하는 안내문이 있는 슬롯은 해당 안내문의 지시에 따라 실제 내용을 작성
5. 정보가 부족하면 참고 자료를 기반으로 합리적으로 추론하여 작성
6. 정보가 전혀 없는 경우에만 빈 문자열("")

## 응답 형식 (JSON):
{
  "filledFields": [
    { "key": "슬롯key값_그대로", "value": "작성된 실제 내용 (플레이스홀더 아님)" },
    ...
  ]
}

**중요**:
- key를 정확하게 사용하세요 (대소문자, 숫자 포함)
- 모든 ${slots!.length}개 슬롯에 대해 빠짐없이 응답하세요
- "※", "OO", "○○", "00명", "00년" 등 플레이스홀더를 그대로 반환하면 안 됩니다
- JSON만 응답하세요.`;

      } else {
        // LABEL 기반 스키마 (기존 방식)
        const fieldsInfo = formStructure
          ? formStructure.map(f => `- ${f.label} (${f.type})`).join("\n")
          : "양식에서 추출된 필드 정보 없음";

        prompt = `당신은 창업 계획서 및 사업 제안서 작성 전문가입니다.

## 양식 텍스트:
${formText}

## 참고 자료:
${sourceText}

## 작업 단계:

### 1단계: 양식 필드 식별
양식에서 입력이 필요한 모든 위치를 찾으세요:
- 빈칸: ____, ________, ________________
- Placeholder: OOO, XXX, 홍길동, [  ]
- 라벨이 있는 필드: "창업아이템명:", "팀 구성:", "문제 인식:"

### 2단계: 각 필드의 의도 파악
라벨과 주변 컨텍스트를 보고 해당 필드가 **무엇을 요구하는지** 정확히 파악:
- "창업아이템명" → 사업의 핵심 아이템 이름
- "산출물" → 사업을 통해 만들어질 구체적 결과물 목록
- "문제 인식(Problem)" → 해결하려는 사회적/시장 문제와 그 배경
- "실현 가능성(Solution)" → 실제 실행 가능한 구체적 해결 방안
- "성장전략(Scale-up)" → 사업 확장 및 성장 계획
- "팀 구성(Team)" → 팀원 역할과 담당 업무

### 3단계: 참고 자료에서 정보 추출
참고 자료를 꼼꼼히 읽고 각 필드에 맞는 **정확한 정보**를 찾으세요.

### 4단계: 내용 작성 규칙
- **짧은 필드** (이름, 직함 등): 간결하게 10-30자
- **중간 필드** (아이템 개요 등): 핵심만 50-100자
- **긴 필드** (문제 인식, 실현 가능성 등): 상세하게 100-300자
- **전문적 톤**: 설득력 있고 구체적으로 작성
- **정보 없음**: 참고 자료에 해당 정보가 없으면 "[정보 없음]"

### 5단계: 필드명 정확히 매칭
양식에 있는 **정확한 라벨명**을 사용하세요 (예: "문제 인식(Problem)", "팀 구성(Team)")

## 응답 형식 (JSON):
{
  "filledFields": [
    {
      "label": "양식의 정확한 필드명",
      "value": "참고 자료 기반으로 작성된 내용"
    }
  ]
}

**중요**:
1. 양식의 모든 빈칸을 빠짐없이 찾아서 채우세요
2. 라벨명은 양식에 있는 그대로 사용 (띄어쓰기, 괄호 포함)
3. 참고 자료를 정확히 반영하되, 자연스럽게 재작성

JSON만 응답하세요.`;
      }

      // 슬롯 수가 많으면 gpt-4o 사용 (gpt-4o-mini는 107개 슬롯 처리 어려움)
      const model = useKeyBasedSchema && slots!.length > 30 ? "gpt-4o" : "gpt-4o-mini";
      console.log(`[analyze-form] AI 모델: ${model}, 슬롯 수: ${slots?.length || 0}`);

      const completion = await openai.chat.completions.create({
        model,
        messages: [
          { role: "system", content: "당신은 문서 작성 전문가입니다. 참고 자료를 바탕으로 정확하게 양식을 채우세요. 모든 슬롯에 대해 빠짐없이 응답하세요." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        max_tokens: 16000,
      });

      const result = completion.choices[0].message.content;
      try {
        const parsed = JSON.parse(result || "{}");
        return NextResponse.json(parsed, { headers: corsHeaders });
      } catch {
        return NextResponse.json(
          {
            filledFields: [],
            suggestions: "자동 채우기에 실패했습니다.",
            raw: result
          },
          { headers: corsHeaders }
        );
      }
    }

    return NextResponse.json(
      { error: "잘못된 action입니다." },
      { status: 400, headers: corsHeaders }
    );

  } catch (error) {
    console.error("양식 분석 API 오류:", error);
    return NextResponse.json(
      { error: "AI 처리 실패" },
      { status: 500, headers: corsHeaders }
    );
  }
}
