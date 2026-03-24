import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type Provider = "openai" | "anthropic";

interface SlotInput {
  key: string;
  kind: string;
  label: string;
  currentText: string;
  xmlPath: string;
  structural?: boolean;
}

interface SlotResult {
  key: string;
  value: string;
}

interface PlannerOutput {
  strategy: string;
  assumptions: string[];
  slotSchema: Array<{
    key: string;
    type: string;
    constraints: string;
    sourceHint: string;
    writeGuide: string;
  }>;
}

interface WorkerOutput {
  results: SlotResult[];
}

interface CriticScores {
  completeness: number;
  relevance: number;
  consistency: number;
}

interface CriticOutput {
  scores: CriticScores;
  issues: Array<{
    severity: "critical" | "warning" | "minor";
    slotKey: string;
    problem: string;
  }>;
  patches: Array<{
    key: string;
    newValue: string;
  }>;
}

function stripCodeFence(raw: string): string {
  let s = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  // 모델이 JSON 뒤에 설명 텍스트를 붙이는 경우 → JSON 부분만 추출
  // 첫 번째 { 또는 [ 를 찾아서 매칭되는 닫는 괄호까지만 추출
  const firstBrace = s.search(/[{\[]/);
  if (firstBrace > 0) {
    s = s.substring(firstBrace);
  }
  if (firstBrace >= 0) {
    const open = s[0]; // '{' or '['
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inStr = false;
    let endIdx = -1;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      // 문자열 내부에서 이스케이프 시퀀스 건너뛰기
      if (inStr && c === "\\" && i + 1 < s.length) {
        i++;
        continue;
      }
      if (c === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
    }
    if (endIdx > 0) {
      s = s.substring(0, endIdx + 1);
    }
  }

  return s;
}

/** JSON 문자열 내부의 이스케이프되지 않은 제어문자 및 잘못된 이스케이프 시퀀스를 수정 */
function sanitizeJsonStrings(input: string): string {
  const result: string[] = [];
  let inStr = false;
  let i = 0;

  while (i < input.length) {
    const c = input[i];

    // 이스케이프된 문자 처리
    if (inStr && c === '\\' && i + 1 < input.length) {
      const next = input[i + 1];
      // 유효한 JSON 이스케이프: \", \\, \/, \b, \f, \n, \r, \t, \uXXXX
      if ('"\\\/bfnrtu'.includes(next)) {
        result.push(c, next);
        i += 2;
      } else {
        // 잘못된 이스케이프 (예: \S, \k 등) → 백슬래시를 이중 이스케이프
        result.push('\\\\', next);
        i += 2;
      }
      continue;
    }

    // 따옴표로 문자열 경계 추적
    if (c === '"') {
      inStr = !inStr;
      result.push(c);
      i++;
      continue;
    }

    // 문자열 내부의 제어문자 이스케이프
    if (inStr) {
      const code = c.charCodeAt(0);
      if (code < 0x20) {
        if (c === '\n') result.push('\\n');
        else if (c === '\r') result.push('\\r');
        else if (c === '\t') result.push('\\t');
        else result.push(`\\u${code.toString(16).padStart(4, '0')}`);
        i++;
        continue;
      }
    }

    result.push(c);
    i++;
  }

  return result.join('');
}

/** 트레일링 콤마 제거: ,} → }, ,] → ] */
function removeTrailingCommas(input: string): string {
  let result = '';
  let inStr = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '\\' && inStr && i + 1 < input.length) {
      result += c + input[i + 1];
      i++;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      result += c;
      continue;
    }
    if (inStr) {
      result += c;
      continue;
    }
    // 콤마 뒤에 공백/줄바꿈 후 } 또는 ] 가 오면 콤마 스킵
    if (c === ',') {
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j])) j++;
      if (j < input.length && (input[j] === '}' || input[j] === ']')) {
        continue; // 콤마 스킵
      }
    }
    result += c;
  }
  return result;
}

function repairTruncatedJson(input: string): string {
  let s = input;

  // 0) 문자열 내 제어문자 이스케이프
  s = sanitizeJsonStrings(s);

  // 1) 잘린 문자열 닫기: 홀수 개의 unescaped 따옴표 → 마지막에 " 추가
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) { i++; continue; }
    if (s[i] === '"') inString = !inString;
  }
  if (inString) s += '"';

  // 2) 마지막 불완전 항목 제거 (쉼표 뒤 잘린 key/value)
  s = s.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"}\]]*$/, "");
  s = s.replace(/,\s*$/, "");

  // 3) 괄호 균형 맞추기
  const stack: string[] = [];
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && inStr && i + 1 < s.length) { i++; continue; }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') stack.pop();
  }
  while (stack.length > 0) {
    s += stack.pop();
  }

  return s;
}

function parseJson<T>(raw: string): T {
  const cleaned = stripCodeFence(raw);

  // 1차: 직접 파싱
  try {
    return JSON.parse(cleaned) as T;
  } catch { /* continue */ }

  // 2차: 제어문자 이스케이프 후 파싱
  const sanitized = sanitizeJsonStrings(cleaned);
  try {
    return JSON.parse(sanitized) as T;
  } catch { /* continue */ }

  // 3차: 트레일링 콤마 제거 + 이스케이프
  const noTrailing = removeTrailingCommas(sanitized);
  try {
    return JSON.parse(noTrailing) as T;
  } catch { /* continue */ }

  // 4차: truncated JSON 복구 시도
  const repaired = repairTruncatedJson(cleaned);
  try {
    return JSON.parse(repaired) as T;
  } catch { /* continue */ }

  // 5차: 트레일링 콤마 제거 + truncated 복구 결합
  const repairedNoTrailing = removeTrailingCommas(repaired);
  try {
    return JSON.parse(repairedNoTrailing) as T;
  } catch (eFinal) {
    console.error("[parseJson] all attempts failed");
    console.error("[parseJson] raw (first 500):", cleaned.substring(0, 500));
    console.error("[parseJson] sanitized (first 500):", sanitized.substring(0, 500));
    throw eFinal;
  }
}

function clampScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(5, Math.round(n)));
}

function normalizeCriticOutput(candidate: CriticOutput): CriticOutput {
  return {
    scores: {
      completeness: clampScore(candidate?.scores?.completeness),
      relevance: clampScore(candidate?.scores?.relevance),
      consistency: clampScore(candidate?.scores?.consistency),
    },
    issues: Array.isArray(candidate?.issues)
      ? candidate.issues.filter((item) => item && typeof item.slotKey === "string")
      : [],
    patches: Array.isArray(candidate?.patches)
      ? candidate.patches.filter((item) => item && typeof item.key === "string" && typeof item.newValue === "string")
      : [],
  };
}

function dedupeAndNormalizeResults(slots: SlotInput[], proposed: SlotResult[]): SlotResult[] {
  const byKey = new Map<string, string>();

  for (const item of proposed) {
    if (!item || typeof item.key !== "string") continue;
    const value = typeof item.value === "string" ? item.value : "";
    byKey.set(item.key, value);
  }

  return slots.map((slot) => ({
    key: slot.key,
    value: byKey.get(slot.key) ?? slot.currentText ?? "",
  }));
}

function buildSlotDescriptions(slots: SlotInput[]): string {
  return slots
    .map((slot, index) => {
      const preview = slot.currentText ? slot.currentText.slice(0, 200) : "";
      const current = preview ? `\n   현재내용: "${preview}"` : "\n   현재내용: (비어있음 - 반드시 채워야 함)";
      return `[${index}] key="${slot.key}" | 종류=${slot.kind} | 라벨="${slot.label}"${current}`;
    })
    .join("\n\n");
}

async function callOpenAIAgent(args: {
  roleName: string;
  systemPrompt: string;
  userPrompt: string;
  primaryModel: string;
  backupModel: string;
  maxTokens: number;
}): Promise<{ content: string; usedModel: string }> {
  const models = [args.primaryModel, args.backupModel];
  let lastError: unknown;

  for (const model of models) {
    try {
      const isReasoningModel = model.startsWith("gpt-5") || model.startsWith("o");
      const systemRole = isReasoningModel ? "developer" : "system";

      // reasoning 모델은 response_format 미지원 가능 → 조건부 적용
      const useJsonMode = !isReasoningModel;

      const completion = await openai.chat.completions.create({
        model,
        ...(isReasoningModel
          ? { max_completion_tokens: args.maxTokens }
          : { max_tokens: args.maxTokens, temperature: 0.2 }),
        ...(useJsonMode ? { response_format: { type: "json_object" as const } } : {}),
        messages: [
          { role: systemRole as "system", content: args.systemPrompt },
          { role: "user", content: args.userPrompt },
        ],
      });

      const finishReason = completion.choices[0]?.finish_reason;
      const content = completion.choices[0]?.message?.content?.trim();

      if (!content) {
        throw new Error(`${args.roleName} returned empty content`);
      }

      // 응답이 잘린 경우 (max_tokens 도달) → 로그 경고 + 복구 시도 허용
      if (finishReason === "length") {
        console.warn(`[${args.roleName}] response truncated (model=${model}, maxTokens=${args.maxTokens})`);
      }

      return { content, usedModel: model };
    } catch (error) {
      console.error(`[${args.roleName}] model=${model} failed:`, error instanceof Error ? error.message : error);
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${args.roleName} failed on both primary and backup model`);
}

async function callAnthropicAgent(args: {
  roleName: string;
  systemPrompt: string;
  userPrompt: string;
  model: string;
  maxTokens: number;
}): Promise<{ content: string; usedModel: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is missing");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: args.model,
      max_tokens: args.maxTokens,
      system: args.systemPrompt,
      messages: [{ role: "user", content: args.userPrompt }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${args.roleName} anthropic failed (${response.status}): ${detail}`);
  }

  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };

  const content = payload.content?.find((item) => item?.type === "text")?.text?.trim();
  if (!content) {
    throw new Error(`${args.roleName} returned empty content`);
  }

  return { content, usedModel: args.model };
}

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "OPENAI_API_KEY is missing" }, { status: 500 });
    }

    const body = await req.json();
    const { slots, sourceText, userRequest, previousResults, targetSlotKeys, criticProvider: criticProviderOverride } = body as {
      slots: SlotInput[];
      sourceText?: string;
      userRequest?: string;
      previousResults?: SlotResult[];
      targetSlotKeys?: string[];
      criticProvider?: "openai" | "anthropic";
    };

    if (!Array.isArray(slots) || slots.length === 0) {
      return NextResponse.json({ error: "slots must be a non-empty array" }, { status: 400 });
    }

    const source = (sourceText ?? "").slice(0, 30000);
    const requestText = (userRequest ?? "").trim();

    const hasPrevResults = Array.isArray(previousResults) && previousResults.length > 0 && !!requestText;
    const hasTargetKeysEarly = Array.isArray(targetSlotKeys) && targetSlotKeys.length > 0;

    // 초기 채우기(비 수정 모드)에서는 structural 슬롯 제외
    // 수정 모드 또는 targetSlotKeys가 지정된 경우에는 structural 슬롯 포함
    const activeSlots = (hasPrevResults || hasTargetKeysEarly)
      ? slots
      : slots.filter((s) => !s.structural);

    const slotDescriptions = buildSlotDescriptions(activeSlots);
    const slotKeys = activeSlots.map((slot) => slot.key);

    const primaryModel = slots.length > 20 ? "gpt-4o" : "gpt-4o-mini";
    const backupModel = primaryModel === "gpt-4o" ? "gpt-4o-mini" : "gpt-4.1-mini";

    // 슬롯 수에 따라 maxTokens 동적 조절 (GPT-5.2: 128K output 지원)
    const workerMaxTokens = Math.min(16000, Math.max(8000, slots.length * 150));
    const plannerMaxTokens = Math.min(16000, Math.max(4000, slots.length * 60));

    const criticProviderEnv = ((criticProviderOverride ?? process.env.MULTI_AGENT_CRITIC_PROVIDER) ?? "openai").toLowerCase();
    const criticProvider: Provider = criticProviderEnv === "anthropic" ? "anthropic" : "openai";

    const modelTrace: string[] = [];

    /* ═══ STEP 1: Planner (GPT-5.2) — 구조 분석 + 슬롯 스키마 + 소스 매핑 ═══ */

    const plannerSystemPrompt = [
      "당신은 한국 정부지원사업 사업계획서 양식 분석 전문가입니다.",
      "DOCX 양식의 슬롯(빈칸)을 분석하여 각 슬롯의 타입, 제약조건, 소스 매핑을 결정합니다.",
      "",
      "## 핵심 역할",
      "1. 각 슬롯이 어떤 종류의 데이터를 기대하는지 파악 (숫자/서술형/날짜/목록/금액 등)",
      "2. 소스 텍스트에서 어떤 부분을 참조해야 하는지 매핑 (sourceHint)",
      "3. Worker가 따라야 할 구체적 작성 가이드 생성 (writeGuide)",
      "",
      "## slotSchema 필드 설명",
      "- key: 슬롯 키 (그대로 복사)",
      "- type: \"숫자\", \"서술형\", \"날짜\", \"목록\", \"금액\", \"기관명\", \"인명\", \"비율\" 등",
      "- constraints: \"100자 이내\", \"연도-월-일\", \"만원 단위\", \"3줄 이내\" 등",
      "- sourceHint: 소스 텍스트에서 참조할 부분 힌트. 소스가 없으면 \"없음\"",
      "- writeGuide: Worker에게 주는 구체적 작성 지침",
      "",
      "## 출력 형식",
      'JSON만 출력: {"strategy":"전체 작성 전략","assumptions":["가정1","가정2"],"slotSchema":[{"key":"...","type":"...","constraints":"...","sourceHint":"...","writeGuide":"..."}]}',
      "",
      "중요: 슬롯이 많으면(30개+) 유사한 슬롯은 그룹으로 묶어 대표 스키마만 작성하세요.",
      "예: TABLE 슬롯 20개가 모두 비슷하면 대표 1-2개만 상세 작성 + 나머지는 \"위와 동일\" 처리.",
    ].join("\n");

    const plannerUserPrompt = [
      "아래 사업계획서 양식의 슬롯을 분석하고 작성 계획을 세워주세요.",
      "",
      "=== 슬롯 목록 ===",
      slotDescriptions,
      "",
      ...(requestText ? [
        "=== 사용자 요청사항 ===",
        requestText,
        "",
      ] : []),
      "=== 사업 정보 (소스 텍스트) ===",
      source || "(소스 텍스트 없음)",
    ].join("\n");

    let planner: PlannerOutput = { strategy: "", assumptions: [], slotSchema: [] };
    if (hasPrevResults) {
      // 수정 요청: Planner 스킵 (이미 분석된 문서의 부분 수정)
      modelTrace.push("planner:skipped(edit)");
    } else {
      try {
        const plannerResponse = await callOpenAIAgent({
          roleName: "planner",
          systemPrompt: plannerSystemPrompt,
          userPrompt: plannerUserPrompt,
          primaryModel: "gpt-5.2",
          backupModel: primaryModel,
          maxTokens: plannerMaxTokens,
        });
        modelTrace.push(`planner:${plannerResponse.usedModel}`);
        planner = parseJson<PlannerOutput>(plannerResponse.content);
      } catch (plannerErr) {
        console.warn("[analyze-form] Planner failed, proceeding without schema:", plannerErr);
        modelTrace.push("planner:skipped");
      }
    }

    /* ═══ STEP 2: Worker (GPT-4o) — Planner 가이드 기반 콘텐츠 생성 ═══ */

    const workerSystemPrompt = hasPrevResults
      ? [
          "당신은 한국 정부지원사업 사업계획서 부분 수정 전문가입니다.",
          "이미 작성된 문서가 있고, 사용자가 특정 부분만 수정을 요청했습니다.",
          "",
          "## 핵심 규칙 (매우 중요)",
          "1. 사용자 요청과 직접 관련된 슬롯만 출력하세요.",
          "2. 변경하지 않는 슬롯은 절대 출력하지 마세요. 서버에서 자동으로 기존 값을 유지합니다.",
          "3. 예: 사용자가 '참고문헌 써줘'라고 하면, 참고문헌 관련 슬롯(1~2개)만 출력하세요.",
          "4. 한국어로 작성하되, 문서에 적합한 전문적이고 구체적인 표현을 사용하세요.",
          "",
          "## 붙여넣기 데이터 매칭 규칙",
          "사용자 메시지에 표 데이터나 여러 줄의 텍스트가 포함되어 있으면:",
          "1. 해당 텍스트와 '현재값'이 일치하는 슬롯들을 찾아 수정 대상으로 판단하세요.",
          "2. '이거', '이 표', '위의 내용', '이 부분' 등 지시어는 메시지에 포함된 텍스트를 가리킵니다.",
          "3. '자료에 맞게 바꿔줘' = 소스 텍스트를 참고하여 해당 슬롯들의 값을 새로 작성하세요.",
          "4. 매칭 시 라벨(label)과 현재값(현재값) 모두 비교하세요. 부분 일치도 인정합니다.",
          "",
          "## 출력 형식",
          "JSON만 출력: {\"results\":[{\"key\":\"슬롯키\",\"value\":\"새로운값\"}]}",
          "⚠️ 수정이 필요한 슬롯만 포함! 나머지는 출력하지 마세요!",
        ].join("\n")
      : [
          "당신은 한국 정부지원사업 사업계획서 작성 전문가입니다.",
          "Planner가 분석한 슬롯 스키마와 작성 가이드를 따라 각 슬롯의 값을 생성합니다.",
          "",
          "## 핵심 규칙",
          "1. Planner의 slotSchema가 있으면 반드시 따르세요. 각 슬롯의 type, constraints, writeGuide를 준수합니다.",
          "2. sourceHint가 있으면 해당 소스 텍스트 부분을 우선 참조하세요.",
          "3. 모든 슬롯에 반드시 실질적인 내용을 채워야 합니다. 빈 값(\"\")은 절대 불가.",
          "4. 한국어로 작성하되, 사업계획서에 적합한 전문적이고 구체적인 표현을 사용하세요.",
          "5. TABLE_CELL 슬롯은 표 안의 칸이므로 간결하게, BODY_SECTION은 본문이므로 상세하게 작성하세요.",
          "6. TEXTBOX 슬롯은 텍스트박스 안의 내용이므로 적절한 분량으로 작성하세요.",
          "",
          "## 출력 형식",
          "JSON만 출력하세요: {\"results\":[{\"key\":\"...\",\"value\":\"...\"}]}",
          "모든 required slot key에 대해 반드시 value를 포함해야 합니다.",
        ].join("\n");

    // 수정 모드: 슬롯 key + label + 종류 + 원본/현재값을 함께 보여줌
    const slotMap = new Map(slots.map(s => [s.key, s]));
    const prevMap = new Map((previousResults ?? []).map(r => [r.key, r.value]));

    // 완전 교체 요청 감지: "다른", "새로운", "아예", "완전히" 등의 키워드가 있으면
    // AI가 현재값을 참고하지 않고 완전히 새로운 내용을 생성하도록 유도
    const isCompleteReplaceRequest = /다른|새로운?|아예|완전히|바꿔|교체|새\s*사례|다른\s*사례|다른\s*예시|새\s*예시|다르게|전혀/.test(requestText);

    // targetSlotKeys가 있으면 사용자가 직접 선택한 슬롯 → 최우선 필터
    const hasTargetKeys = Array.isArray(targetSlotKeys) && targetSlotKeys.length > 0;
    const targetKeySet = hasTargetKeys ? new Set(targetSlotKeys) : null;
    if (hasTargetKeys) {
      modelTrace.push(`targetSlots:${targetSlotKeys!.length}`);
    }

    // 사용자 요청에서 키워드 추출 (2자 이상 단어) — targetKeys 없을 때 폴백
    const requestWords = requestText
      .replace(/[^가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length >= 2);

    // 슬롯 관련도 점수 계산 → 관련 슬롯만 필터
    // activeSlots 전체를 기반으로 점수 매김 (structural 슬롯 포함)
    type ScoredSlot = { key: string; score: number; line: string };
    const scoredSlots: ScoredSlot[] = activeSlots.map(slot => {
      const label = slot.label || "?";
      const kind = slot.kind || "?";
      const original = slot.currentText?.substring(0, 120) || "";
      const aiValue = (prevMap.get(slot.key) || "").substring(0, 120);
      const displayValue = aiValue || original;

      // targetKeys가 있으면 해당 키만 높은 점수
      let score = 0;
      if (targetKeySet) {
        score = targetKeySet.has(slot.key) ? 100 : 0;
      } else {
        // 1) 키워드 매칭
        const matchTarget = `${label} ${original} ${displayValue}`.toLowerCase();
        for (const w of requestWords) {
          if (matchTarget.includes(w.toLowerCase())) score++;
        }
        // 2) 직접 내용 매칭: 슬롯의 현재 텍스트가 사용자 메시지에 그대로 포함됨
        //    (사용자가 표 내용을 복사-붙여넣기한 경우)
        const reqLower = requestText.toLowerCase();
        if (original.length >= 2 && reqLower.includes(original.toLowerCase())) {
          score += 10; // 강한 매칭 보너스
        }
        if (aiValue && aiValue.length >= 2 && reqLower.includes(aiValue.toLowerCase())) {
          score += 10;
        }
      }

      const originalPart = original && original !== displayValue
        ? `\n  원본: "${original.substring(0, 80)}"`
        : "";
      // 완전 교체 요청이면 현재값 대신 "완전히 새로운 내용으로 교체" 안내
      const preview = isCompleteReplaceRequest
        ? "(현재값 무시 — 완전히 새로운 내용으로 작성할 것)"
        : displayValue.substring(0, 80) + (displayValue.length > 80 ? "..." : "");
      const line = `- key="${slot.key}" | 라벨="${label}" | 종류=${kind}${originalPart}\n  현재값: "${preview}"`;

      return { key: slot.key, score, line };
    });

    // 필터: targetKeys > keyword matching > 전체
    const hasRelevant = scoredSlots.some(s => s.score > 0);
    const filteredSlots = hasRelevant
      ? scoredSlots.filter(s => s.score > 0).sort((a, b) => b.score - a.score)
      : scoredSlots;
    const editSlotList = filteredSlots.map(s => s.line).join("\n");
    const filterNote = targetKeySet
      ? `(사용자가 선택한 ${filteredSlots.length}개 슬롯)`
      : hasRelevant
        ? `(사용자 요청과 관련된 ${filteredSlots.length}개 슬롯만 표시, 전체 ${scoredSlots.length}개)`
        : `(전체 ${scoredSlots.length}개 슬롯)`;

    // 내용 일치 슬롯 목록 생성: 사용자 메시지에 currentText가 그대로 포함된 슬롯
    const contentMatchedKeys: string[] = [];
    if (!targetKeySet) {
      const reqLower = requestText.toLowerCase();
      for (const slot of activeSlots) {
        const ct = (slot.currentText || "").trim();
        const av = (prevMap.get(slot.key) || "").trim();
        if (ct.length >= 2 && reqLower.includes(ct.toLowerCase())) {
          contentMatchedKeys.push(slot.key);
        } else if (av.length >= 2 && reqLower.includes(av.toLowerCase())) {
          contentMatchedKeys.push(slot.key);
        }
      }
    }

    const workerPrompt = hasPrevResults
      ? [
          "사용자가 이미 작성된 문서에서 특정 부분만 수정을 요청했습니다.",
          "",
          "=== 사용자 수정 요청 ===",
          requestText,
          "",
          `=== 관련 슬롯 목록 ${filterNote} ===`,
          "아래 목록에서 사용자 요청과 관련된 슬롯을 찾아 해당 key로 수정 결과를 출력하세요.",
          editSlotList,
          "",
          // 내용 일치 슬롯이 있으면 명시적으로 알려줌
          ...(contentMatchedKeys.length > 0 ? [
            `=== ⚠️ 내용 일치 슬롯 (${contentMatchedKeys.length}개) ===`,
            "아래 슬롯들의 현재값이 사용자 메시지에서 그대로 발견되었습니다.",
            "사용자가 이 슬롯들의 위치를 복사-붙여넣기로 지정한 것이므로, 이 슬롯들을 수정 대상으로 판단하세요:",
            contentMatchedKeys.map(k => {
              const s = slotMap.get(k);
              return `  - ${k}: "${s?.label || "?"}" (현재값: "${(prevMap.get(k) || s?.currentText || "").substring(0, 40)}")`;
            }).join("\n"),
            "",
          ] : []),
          "=== 사업 정보 (소스 텍스트) ===",
          source || "(없음 - 소스가 없으면 사용자 요청의 문맥을 참고하여 적절한 내용으로 수정하세요)",
          "",
          ...(isCompleteReplaceRequest ? [
            "🚨 완전 교체 요청: 현재값을 절대 참고하지 마세요!",
            "현재값과 완전히 다른 새로운 사례/예시/내용을 처음부터 창작하세요.",
            "비슷한 표현, 유사한 구조도 금지. 주제·소재·표현 모두 달라야 합니다.",
          ] : []),
          ...(targetKeySet ? [
            `⚠️ 매우 중요: 사용자가 아래 ${targetKeySet.size}개 슬롯을 직접 선택했습니다. 이 슬롯들만 수정하세요!`,
            `선택된 슬롯 키: ${Array.from(targetKeySet).join(", ")}`,
          ] : contentMatchedKeys.length > 0 ? [
            `⚠️ 매우 중요: 위 '내용 일치 슬롯'을 반드시 수정하세요! 사용자가 해당 부분을 복사해서 보여준 것입니다.`,
            "각 슬롯에 소스 텍스트 또는 요청 문맥에 맞는 새로운 값을 작성하세요.",
          ] : [
            "⚠️ 중요: 사용자 요청과 관련된 슬롯의 key만 results에 포함하세요!",
          ]),
          "사용자가 새 내용을 제공했으면, 해당 내용을 슬롯 값으로 적용하세요.",
          "변경하지 않는 슬롯은 절대 출력하지 마세요. 서버에서 기존 값을 자동 유지합니다.",
        ].join("\n")
      : [
          "아래 사업계획서 양식의 모든 슬롯을 채워주세요.",
          "",
          ...(planner.strategy ? [
            "=== Planner 작성 전략 ===",
            planner.strategy,
            "",
            "전제 조건:",
            JSON.stringify(planner.assumptions || []),
            "",
            "=== 슬롯 스키마 (Planner 분석 결과) ===",
            JSON.stringify(planner.slotSchema || []),
            "",
          ] : []),
          "=== 필수 슬롯 키 목록 ===",
          JSON.stringify(slotKeys),
          "",
          "=== 각 슬롯 상세 정보 ===",
          slotDescriptions,
          "",
          ...(requestText ? [
            "=== 사용자 요청사항 ===",
            requestText,
            "",
          ] : []),
          "=== 사업 정보 (소스 텍스트) ===",
          source || "(소스 텍스트 없음 - 슬롯의 label과 현재내용을 참고하여 합리적인 내용을 생성하세요)",
        ].join("\n");

    const editWorkerMaxTokens = hasPrevResults ? Math.min(8000, workerMaxTokens) : workerMaxTokens;

    const workerResponse = await callOpenAIAgent({
      roleName: "worker",
      systemPrompt: workerSystemPrompt,
      userPrompt: workerPrompt,
      primaryModel,
      backupModel,
      maxTokens: editWorkerMaxTokens,
    });
    modelTrace.push(`worker:${workerResponse.usedModel}`);

    let worker: WorkerOutput;
    try {
      worker = parseJson<WorkerOutput>(workerResponse.content);
    } catch (parseErr) {
      console.error(`[worker] JSON parse failed (model=${workerResponse.usedModel})`);
      console.error(`[worker] raw response (first 800):`, workerResponse.content.substring(0, 800));
      throw parseErr;
    }

    // 수정 모드: Worker가 변경한 슬롯만 반환 → previousResults에 머지
    let editedCount = 0;
    const editedDetails: Array<{ key: string; label: string; before: string; after: string }> = [];
    if (hasPrevResults && previousResults) {
      const editedMap = new Map((worker.results || []).map(r => [r.key, r.value]));

      // 실제로 값이 바뀐 슬롯만 카운트 + 상세 정보 수집
      for (const r of (worker.results || [])) {
        const prevValue = prevMap.get(r.key) || slotMap.get(r.key)?.currentText || "";
        const newValue = r.value || "";
        if (newValue.trim() !== prevValue.trim()) {
          editedCount++;
          const info = slotMap.get(r.key);
          editedDetails.push({
            key: r.key,
            label: info?.label || r.key,
            before: prevValue.substring(0, 40),
            after: newValue.substring(0, 40),
          });
          console.log(`[edit] 실제 변경: ${r.key} (${info?.label || "?"}) "${prevValue.substring(0, 30)}" → "${newValue.substring(0, 30)}"`);
        } else {
          console.log(`[edit] 값 동일 (변경 아님): ${r.key} (${slotMap.get(r.key)?.label || "?"})`);
        }
      }

      // previousResults를 베이스로, Worker 결과로 덮어쓰기
      const merged: SlotResult[] = previousResults.map(prev => ({
        key: prev.key,
        value: editedMap.get(prev.key) ?? prev.value,
      }));

      // Worker가 새로 추가한 키 (previousResults에 없던 것)
      for (const r of (worker.results || [])) {
        if (!previousResults.find(p => p.key === r.key)) {
          merged.push(r);
        }
      }

      worker.results = merged;
      modelTrace.push(`edit:merged(actual:${editedCount},worker:${editedMap.size}/${previousResults.length})`);
    }

    /* ═══ STEP 3: Critic+Patcher ═══ */

    // 수정 모드에서는 Critic 스킵 (부분 수정이라 QA 불필요 + 속도 향상)
    if (hasPrevResults) {
      modelTrace.push("critic:skipped(edit)");
      const finalResults = dedupeAndNormalizeResults(slots, worker.results || []);
      // contentMatchedKeys 정보를 클라이언트에 전달 (되묻기용)
      const matchedSlotInfos = contentMatchedKeys.map(k => {
        const s = slotMap.get(k);
        return { key: k, label: s?.label || k };
      });

      return NextResponse.json({
        results: finalResults,
        editedCount,
        editedDetails,
        contentMatchedSlots: matchedSlotInfos,
        meta: {
          model: primaryModel,
          criticProvider,
          modelTrace,
          scores: { completeness: 5, relevance: 5, consistency: 5 },
          pipeline: ["planner:skipped", "worker", "critic:skipped", "edit-merge"],
          patchCount: 0,
          issueCount: { critical: 0, total: 0 },
        },
      });
    }

    // 일반 모드: Critic 실행
    const criticSystemPrompt = [
      "당신은 사업계획서 품질 검수 전문가입니다. 엄격하고 간결합니다.",
      "Worker가 생성한 슬롯 값을 검토하고, 심각한 문제가 있는 슬롯은 직접 수정값(patch)을 제공합니다.",
      "",
      "## 검토 기준",
      "1. completeness: 모든 슬롯이 채워졌는가? 빈 값은 없는가?",
      "2. relevance: 소스 텍스트와 슬롯 label에 맞는 내용인가?",
      "3. consistency: 슬롯 간 일관성이 있는가? (사업명, 금액, 날짜 등 모순 없는가)",
      "",
      "## 출력 형식",
      "JSON만 출력:",
      '{',
      '  "scores": {"completeness":1-5, "relevance":1-5, "consistency":1-5},',
      '  "issues": [{"severity":"critical|warning|minor", "slotKey":"...", "problem":"..."}],',
      '  "patches": [{"key":"...", "newValue":"..."}]',
      '}',
      "",
      "## patches 규칙",
      '- severity가 "critical"인 이슈만 패치를 생성하세요.',
      '- "warning"/"minor"는 이슈만 기록하고 패치는 만들지 마세요.',
      '- 패치가 없으면 patches: [] (빈 배열)',
    ].join("\n");

    const criticPrompt = [
      "아래 Worker 출력물을 검토하고 품질을 평가해주세요.",
      "",
      "필수 슬롯 키:",
      JSON.stringify(slotKeys),
      "",
      "슬롯 메타데이터:",
      slotDescriptions,
      "",
      "Worker 출력:",
      JSON.stringify(worker),
      "",
      "사용자 요청:",
      requestText || "(없음)",
      "",
      "소스 텍스트:",
      source || "(없음)",
    ].join("\n");

    let criticRaw: string;
    if (criticProvider === "anthropic") {
      try {
        const criticResponse = await callAnthropicAgent({
          roleName: "critic",
          systemPrompt: criticSystemPrompt,
          userPrompt: criticPrompt,
          model: "claude-sonnet-4-5-20250929",
          maxTokens: 4000,
        });
        criticRaw = criticResponse.content;
        modelTrace.push(`critic:${criticResponse.usedModel}`);
      } catch {
        const criticFallback = await callOpenAIAgent({
          roleName: "critic",
          systemPrompt: criticSystemPrompt,
          userPrompt: criticPrompt,
          primaryModel,
          backupModel,
          maxTokens: 4000,
        });
        criticRaw = criticFallback.content;
        modelTrace.push(`critic:${criticFallback.usedModel}`);
      }
    } else {
      const criticResponse = await callOpenAIAgent({
        roleName: "critic",
        systemPrompt: criticSystemPrompt,
        userPrompt: criticPrompt,
        primaryModel,
        backupModel,
        maxTokens: 4000,
      });
      criticRaw = criticResponse.content;
      modelTrace.push(`critic:${criticResponse.usedModel}`);
    }

    const critic = normalizeCriticOutput(parseJson<CriticOutput>(criticRaw));

    /* ═══ 패치 적용 (Refiner 대체) ═══ */

    let finalResults = dedupeAndNormalizeResults(activeSlots, worker.results || []);

    if (critic.patches && critic.patches.length > 0) {
      const patchMap = new Map(critic.patches.map((p) => [p.key, p.newValue]));
      finalResults = finalResults.map((r) => ({
        key: r.key,
        value: patchMap.get(r.key) ?? r.value,
      }));
      modelTrace.push(`patches:${critic.patches.length}`);
    }

    const criticalCount = critic.issues.filter((i) => i.severity === "critical").length;

    return NextResponse.json({
      results: finalResults,
      meta: {
        model: primaryModel,
        criticProvider,
        modelTrace,
        scores: critic.scores,
        pipeline: ["planner", "worker", "critic", critic.patches.length > 0 ? "patched" : "no-patch"],
        patchCount: critic.patches.length,
        issueCount: { critical: criticalCount, total: critic.issues.length },
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : "";
    console.error("[analyze-form] PIPELINE FAILED:", msg);
    console.error("[analyze-form] STACK:", stack);
    return NextResponse.json(
      {
        error: `Pipeline failed: ${msg}`,
        detail: msg,
        stack: process.env.NODE_ENV === "development" ? stack : undefined,
      },
      { status: 500 }
    );
  }
}

