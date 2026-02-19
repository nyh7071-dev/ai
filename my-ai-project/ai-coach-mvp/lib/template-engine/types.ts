// Template Engine Types

export interface IRNode {
  nodeId: string;
  text: string;
  path: string; // e.g., "document:p12", "table3:r2:c1", "header1:p4"
  styleHints: {
    fontSize?: number;
    color?: string;
    bold?: boolean;
    italic?: boolean;
    alignment?: string;
  };
  neighbors: {
    prev?: string; // previous nodeId
    next?: string; // next nodeId
  };
  tableContext?: {
    rowIndex: number;
    colIndex: number;
    labelLeft?: string;
    labelTop?: string;
  };
  xmlPath: string; // actual xml location for editing
}

export interface IR {
  nodes: IRNode[];
  metadata: {
    fileName: string;
    totalPages?: number;
    createdDate?: string;
  };
}

export type NodeRole =
  | "STATIC"        // 고정 문구
  | "INSTRUCTION"   // 작성요령
  | "EXAMPLE"       // 예시
  | "PLACEHOLDER"   // 입력칸
  | "LABEL"         // 항목명
  | "OPTION";       // 선택지

export type NodeAction =
  | "KEEP"          // 유지
  | "DELETE"        // 삭제
  | "REPLACE";      // 교체(슬롯 채우기)

export interface ClassifiedNode {
  nodeId: string;
  role: NodeRole;
  action: NodeAction;
  slot: string | null;
  constraints: {
    maxChars?: number | null;
    format?: string | null;
  };
  confidence: number; // 0~1
}

export interface ClassifiedIR {
  nodes: ClassifiedNode[];
  metadata: {
    totalSlots: number;
    lowConfidenceNodes: string[]; // nodeIds that need manual review
  };
}

export interface SlotValue {
  slot: string;
  value: string;
}

export interface TemplateEngineConfig {
  // LLM settings
  llmModel?: string;
  llmTemperature?: number;

  // Classification thresholds
  confidenceThreshold?: number; // 0.7 기본값

  // Annotation method
  annotationMethod?: "sdt" | "bookmark" | "placeholder"; // sdt 우선

  // Rule-based detection patterns
  instructionKeywords?: string[];
  exampleKeywords?: string[];
  deleteKeywords?: string[];
  placeholderPatterns?: RegExp[];
}
