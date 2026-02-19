// DOCX Classifier - Rule-based + LLM classification

import type {
  IR,
  IRNode,
  ClassifiedIR,
  ClassifiedNode,
  TemplateEngineConfig,
  NodeRole,
  NodeAction,
} from "./types";
import OpenAI from "openai";

const DEFAULT_CONFIG: Required<TemplateEngineConfig> = {
  llmModel: "gpt-4o-mini",
  llmTemperature: 0.1,
  confidenceThreshold: 0.7,
  annotationMethod: "sdt",
  instructionKeywords: [
    "※",
    "작성요령",
    "유의",
    "참고",
    "주의",
    "안내",
    "작성방법",
  ],
  exampleKeywords: ["예시", "예)", "(예시)", "예:", "Example"],
  deleteKeywords: [
    "삭제",
    "해당없음 삭제",
    "작성 후 삭제",
    "해당사항 없을 시 삭제",
  ],
  placeholderPatterns: [
    /__+/g, // ____
    /\([\s]+\)/g, // (    )
    /\[[\s]+\]/g, // [   ]
    /OOO/g,
    /홍길동/g,
    /000/g,
    /\{[\s]*\}/g, // { }
    /XXX/g,
  ],
};

export async function classifyIR(
  ir: IR,
  openaiClient: OpenAI,
  config: Partial<TemplateEngineConfig> = {}
): Promise<ClassifiedIR> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const classifiedNodes: ClassifiedNode[] = [];
  const lowConfidenceNodes: string[] = [];

  for (let i = 0; i < ir.nodes.length; i++) {
    const node = ir.nodes[i];

    // 1st pass: Rule-based classification
    const ruleResult = classifyByRules(node, finalConfig);

    // 2nd pass: LLM classification (if confidence is low or ambiguous)
    let finalClassification: ClassifiedNode;

    if (ruleResult.confidence < finalConfig.confidenceThreshold) {
      // Get context
      const context = getNodeContext(ir.nodes, i);

      // LLM classification
      try {
        const llmResult = await classifyByLLM(
          node,
          context,
          openaiClient,
          finalConfig
        );
        finalClassification = llmResult;
      } catch (error) {
        console.error(`LLM classification failed for ${node.nodeId}:`, error);
        finalClassification = ruleResult;
      }
    } else {
      finalClassification = ruleResult;
    }

    // Track low confidence nodes
    if (finalClassification.confidence < finalConfig.confidenceThreshold) {
      lowConfidenceNodes.push(node.nodeId);
    }

    classifiedNodes.push(finalClassification);
  }

  const totalSlots = classifiedNodes.filter((n) => n.slot !== null).length;

  return {
    nodes: classifiedNodes,
    metadata: {
      totalSlots,
      lowConfidenceNodes,
    },
  };
}

function classifyByRules(
  node: IRNode,
  config: Required<TemplateEngineConfig>
): ClassifiedNode {
  const text = node.text;
  let role: NodeRole = "STATIC";
  let action: NodeAction = "KEEP";
  let slot: string | null = null;
  let confidence = 0.5;

  // Check instruction keywords
  if (
    config.instructionKeywords.some((kw) => text.includes(kw))
  ) {
    role = "INSTRUCTION";
    action = "KEEP";
    confidence = 0.9;
    return { nodeId: node.nodeId, role, action, slot, constraints: {}, confidence };
  }

  // Check example keywords
  if (config.exampleKeywords.some((kw) => text.includes(kw))) {
    role = "EXAMPLE";
    action = "DELETE";
    confidence = 0.9;
    return { nodeId: node.nodeId, role, action, slot, constraints: {}, confidence };
  }

  // Check delete keywords
  if (config.deleteKeywords.some((kw) => text.includes(kw))) {
    role = "EXAMPLE";
    action = "DELETE";
    confidence = 0.95;
    return { nodeId: node.nodeId, role, action, slot, constraints: {}, confidence };
  }

  // Check placeholder patterns
  const matchedPattern = config.placeholderPatterns.find((pattern) =>
    pattern.test(text)
  );
  if (matchedPattern) {
    role = "PLACEHOLDER";
    action = "REPLACE";
    slot = generateSlotName(node);
    confidence = 0.8;

    // Check constraints
    const constraints: ClassifiedNode["constraints"] = {};
    if (text.match(/\d+자/)) {
      const match = text.match(/(\d+)자/);
      if (match) constraints.maxChars = parseInt(match[1]);
    }
    if (text.includes("YYYY-MM-DD") || text.includes("년월일")) {
      constraints.format = "date";
    }
    if (text.includes("금액") || text.includes("원")) {
      constraints.format = "currency";
    }

    return { nodeId: node.nodeId, role, action, slot, constraints, confidence };
  }

  // Table label detection
  if (node.tableContext && node.tableContext.colIndex === 0) {
    // Left column in table is often a label
    if (text.endsWith(":") || text.endsWith("：")) {
      role = "LABEL";
      action = "KEEP";
      confidence = 0.85;
      return { nodeId: node.nodeId, role, action, slot, constraints: {}, confidence };
    }
  }

  // Table input field detection
  if (
    node.tableContext &&
    node.tableContext.colIndex > 0 &&
    node.tableContext.labelLeft
  ) {
    // Right column with label on left is likely an input field
    if (text.trim().length < 50 && !text.includes("※")) {
      role = "PLACEHOLDER";
      action = "REPLACE";
      slot = generateSlotNameFromLabel(node.tableContext.labelLeft);
      confidence = 0.75;
      return { nodeId: node.nodeId, role, action, slot, constraints: {}, confidence };
    }
  }

  // Default: low confidence static
  return { nodeId: node.nodeId, role, action, slot, constraints: {}, confidence: 0.5 };
}

function getNodeContext(nodes: IRNode[], currentIndex: number) {
  const current = nodes[currentIndex];
  const prevTexts = nodes
    .slice(Math.max(0, currentIndex - 2), currentIndex)
    .map((n) => n.text);
  const nextTexts = nodes
    .slice(currentIndex + 1, Math.min(nodes.length, currentIndex + 3))
    .map((n) => n.text);

  // Find section title (look backwards for heading-like text)
  let sectionTitle: string | null = null;
  for (let i = currentIndex - 1; i >= Math.max(0, currentIndex - 10); i--) {
    const node = nodes[i];
    if (
      node.styleHints.bold &&
      node.styleHints.fontSize &&
      node.styleHints.fontSize > 12 &&
      node.text.length < 100
    ) {
      sectionTitle = node.text;
      break;
    }
  }

  return {
    sectionTitle: sectionTitle || "",
    tableLabelLeft: current.tableContext?.labelLeft || null,
    prevTexts,
    nodeText: current.text,
    nextTexts,
    styleHints: current.styleHints,
  };
}

async function classifyByLLM(
  node: IRNode,
  context: ReturnType<typeof getNodeContext>,
  openaiClient: OpenAI,
  config: Required<TemplateEngineConfig>
): Promise<ClassifiedNode> {
  const systemPrompt = `SYSTEM:
너는 한국어 DOCX 양식의 문장/셀/텍스트박스를 분류하는 문서 분석기다.
반드시 JSON만 출력한다. 설명 문장 금지.`;

  const userPrompt = `USER:
다음은 DOCX에서 추출한 한 노드와 문맥이다.
- sectionTitle: "${context.sectionTitle}"
- tableLabelLeft: "${context.tableLabelLeft}"
- prevTexts: ${JSON.stringify(context.prevTexts)}
- nodeText: "${context.nodeText}"
- nextTexts: ${JSON.stringify(context.nextTexts)}
- styleHints: ${JSON.stringify(context.styleHints)}

할 일:
1) nodeText가 고정 문구인지(STATIC), 작성요령(INSTRUCTION), 예시(EXAMPLE), 입력칸(PLACEHOLDER), 항목명(LABEL), 선택지(OPTION)인지 분류.
2) 입력칸이면 slot 이름을 한국어/영문 혼합의 짧은 키로 만든다(예: company_name, problem_summary, market_size_krw).
3) 지울 텍스트면 action=DELETE, 유지면 KEEP, 채워야 하면 REPLACE.
4) 길이 제한/형식 제한이 있으면 constraints에 반영(예: "3줄 이내", "금액", "YYYY-MM-DD").
5) confidence는 0~1.

반드시 아래 형식 그대로:
{
  "nodeId": "${node.nodeId}",
  "role": "...",
  "action": "...",
  "slot": "... or null",
  "constraints": {"maxChars": null, "format": null},
  "confidence": 0.0
}`;

  try {
    const completion = await openaiClient.chat.completions.create({
      model: config.llmModel,
      temperature: config.llmTemperature,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });

    const result = completion.choices[0].message.content;
    if (!result) throw new Error("Empty LLM response");

    const parsed = JSON.parse(result) as ClassifiedNode;

    // Validate and normalize
    if (!parsed.role || !parsed.action) {
      throw new Error("Invalid LLM response structure");
    }

    return {
      nodeId: node.nodeId,
      role: parsed.role,
      action: parsed.action,
      slot: parsed.slot || null,
      constraints: parsed.constraints || {},
      confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
    };
  } catch (error) {
    console.error("LLM classification error:", error);
    throw error;
  }
}

function generateSlotName(node: IRNode): string {
  // Generate slot name from context
  if (node.tableContext?.labelLeft) {
    return generateSlotNameFromLabel(node.tableContext.labelLeft);
  }

  // Fallback to path-based name
  const pathParts = node.path.split(":");
  return `slot_${pathParts[pathParts.length - 1]}`;
}

function generateSlotNameFromLabel(label: string): string {
  // Convert Korean label to snake_case slug
  const normalized = label
    .replace(/:/g, "")
    .replace(/：/g, "")
    .replace(/\s+/g, "_")
    .toLowerCase();

  // Simple Korean to English mapping (expand as needed)
  const mapping: Record<string, string> = {
    이름: "name",
    성명: "name",
    회사명: "company_name",
    기업명: "company_name",
    날짜: "date",
    작성일: "date",
    주소: "address",
    전화번호: "phone",
    이메일: "email",
    금액: "amount",
    내용: "content",
    설명: "description",
    문제: "problem",
    목표: "goal",
    시장: "market",
  };

  for (const [kr, en] of Object.entries(mapping)) {
    if (normalized.includes(kr)) {
      return en;
    }
  }

  return normalized.substring(0, 30);
}
