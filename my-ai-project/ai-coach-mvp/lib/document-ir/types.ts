// Document IR (Intermediate Representation) 타입 정의
// 모든 문서 형식(DOCX, PDF, ODT)을 통일된 구조로 표현

// ============ Document IR ============

export interface DocumentIR {
  doc_id: string;
  format: 'docx' | 'pdf' | 'odt';
  metadata: DocumentMetadata;
  blocks: Block[];
  anchors: Anchor[];
}

export interface DocumentMetadata {
  title?: string;
  author?: string;
  created?: string;
  modified?: string;
  pageCount?: number;
}

// Block Types
export type Block = ParagraphBlock | TableBlock | HeadingBlock | ListBlock | ImageBlock;

export interface BaseBlock {
  id: string;
  type: string;
  style?: BlockStyle;
}

export interface ParagraphBlock extends BaseBlock {
  type: 'paragraph';
  text: string;
  runs: TextRun[];
}

export interface HeadingBlock extends BaseBlock {
  type: 'heading';
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  runs: TextRun[];
}

export interface TableBlock extends BaseBlock {
  type: 'table';
  rows: TableRow[];
  columnCount: number;
}

export interface ListBlock extends BaseBlock {
  type: 'list';
  listType: 'bullet' | 'numbered';
  items: ListItem[];
}

export interface ImageBlock extends BaseBlock {
  type: 'image';
  alt?: string;
  width?: number;
  height?: number;
}

// Sub-structures
export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  // XML 위치 정보 (패치용)
  xmlStart?: number;
  xmlEnd?: number;
}

export interface TableRow {
  cells: TableCell[];
  isHeader?: boolean;
}

export interface TableCell {
  text: string;
  runs: TextRun[];
  rowSpan?: number;
  colSpan?: number;
  style?: CellStyle;
  // 셀 위치 정보
  rowIndex: number;
  colIndex: number;
  // XML 위치 정보 (패치용)
  xmlStart?: number;
  xmlEnd?: number;
}

export interface ListItem {
  text: string;
  runs: TextRun[];
  level: number;
}

export interface BlockStyle {
  alignment?: 'left' | 'center' | 'right' | 'justify';
  indent?: number;
  spaceBefore?: number;
  spaceAfter?: number;
}

export interface CellStyle {
  backgroundColor?: string;
  borderStyle?: string;
  verticalAlign?: 'top' | 'middle' | 'bottom';
  width?: number;
}

// Anchor: 특정 위치를 참조하기 위한 정보
export interface Anchor {
  anchor_id: string;
  type: 'text' | 'heading' | 'table_start' | 'cell';
  text: string;
  block_id: string;
  offset?: number;
  row?: number;
  col?: number;
}

// ============ Slot Schema ============

export interface SlotSchema {
  template_id: string;
  template_name?: string;
  created_at: string;
  slots: Slot[];
}

export interface Slot {
  slot_id: string;
  label: string;
  slot_type: SlotType;
  selector: SlotSelector;
  constraints?: SlotConstraints;
  context?: SlotContext;
}

export type SlotType =
  | 'short_text'      // 짧은 텍스트 (이름, 번호 등)
  | 'long_text'       // 긴 서술형
  | 'date'            // 날짜
  | 'number'          // 숫자
  | 'money'           // 금액
  | 'checkbox'        // 체크박스
  | 'enum'            // 선택형 (예/아니오 등)
  | 'table_repeat';   // 반복 테이블 행

export interface SlotSelector {
  strategy: 'table_cell' | 'paragraph' | 'heading_section' | 'checkbox' | 'table_repeat';
  path: SlotPath;
  fallback_anchors?: FallbackAnchor[];
}

export interface SlotPath {
  block_id: string;
  row?: number;
  cell?: number;
  // XML 위치 정보
  xmlStart?: number;
  xmlEnd?: number;
}

export interface FallbackAnchor {
  before?: string;
  after?: string;
  label_text?: string;
}

export interface SlotConstraints {
  max_chars?: number;
  min_chars?: number;
  required?: boolean;
  hint?: string;
  pattern?: string;
  enum_values?: string[];
}

export interface SlotContext {
  section?: string;
  nearby_text?: string[];
  table_headers?: string[];
}

// ============ Knowledge IR (사용자 자료) ============

export interface KnowledgeIR {
  project_id: string;
  entities: {
    company?: CompanyEntity;
    founder?: PersonEntity;
    team?: PersonEntity[];
    [key: string]: any;
  };
  facts: Fact[];
  numbers: NumberFact[];
  documents: DocumentReference[];
}

export interface CompanyEntity {
  name?: string;
  reg_no?: string;
  address?: string;
  industry?: string;
  founded?: string;
  employees?: number;
}

export interface PersonEntity {
  name?: string;
  role?: string;
  phone?: string;
  email?: string;
  education?: string;
  experience?: string;
}

export interface Fact {
  key: string;
  value: string;
  evidence?: string[];
  confidence?: number;
}

export interface NumberFact {
  key: string;
  value: number;
  unit?: string;
  year?: number;
}

export interface DocumentReference {
  doc_id: string;
  type: 'pdf' | 'docx' | 'text' | 'url';
  title?: string;
  summary?: string;
}

// ============ Fill JSON (LLM 출력) ============

export interface FillResult {
  fills: SlotFill[];
  questions: SlotQuestion[];
  warnings?: string[];
}

export interface SlotFill {
  slot_id: string;
  value: string;
  confidence: number;
  reason?: string;
}

export interface SlotQuestion {
  slot_id: string;
  ask: string;
  suggestions?: string[];
}

// ============ Document Patch ============

export interface DocumentPatch {
  doc_id: string;
  ops: PatchOp[];
}

export type PatchOp =
  | SetCellTextOp
  | SetParagraphTextOp
  | SetHeadingTextOp
  | CheckBoxOp
  | InsertTableRowOp;

export interface SetCellTextOp {
  op: 'set_cell_text';
  selector: {
    block_id: string;
    row: number;
    cell: number;
  };
  text: string;
}

export interface SetParagraphTextOp {
  op: 'set_paragraph_text';
  selector: {
    block_id: string;
  };
  text: string;
}

export interface SetHeadingTextOp {
  op: 'set_heading_text';
  selector: {
    block_id: string;
  };
  text: string;
}

export interface CheckBoxOp {
  op: 'check_box';
  selector: {
    block_id: string;
    offset?: number;
  };
  value: boolean;
}

export interface InsertTableRowOp {
  op: 'insert_table_row';
  selector: {
    block_id: string;
    after_row: number;
  };
  cells: string[];
}
