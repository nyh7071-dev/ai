/**
 * lib/docx/textboxScanner.ts
 *
 * w:txbxContent (텍스트박스) 스캔 및 슬롯 추출
 * - fillable 텍스트박스 감지: OOO, 00.00, 0개, 예정('00.0) 등의 패턴
 * - label 전용 텍스트박스 제외: 창업아이템명, 직업, 기업(예정)명 등
 */

/**
 * 노드의 qualified name 가져오기
 */
function nodeQName(node: any): string {
  return (node?.tagName || node?.nodeName || '').toString();
}

/**
 * 노드의 local name 가져오기 (프리픽스 제거)
 */
function nodeLocal(node: any): string {
  const q = nodeQName(node);
  const idx = q.indexOf(':');
  return idx >= 0 ? q.slice(idx + 1) : q;
}

/**
 * 노드가 특정 local name인지 확인
 */
function isLocal(node: any, local: string): boolean {
  return nodeLocal(node) === local;
}

/**
 * DOM 전체에서 특정 local name의 모든 요소 가져오기
 */
function getAllElementsLocal(node: any, local: string): any[] {
  const out: any[] = [];
  if (!node) return out;
  if (isLocal(node, local)) out.push(node);
  const kids = node.childNodes || [];
  for (let i = 0; i < kids.length; i++) {
    out.push(...getAllElementsLocal(kids[i], local));
  }
  return out;
}

/**
 * 텍스트 normalize (모든 공백 제거)
 */
function normalizeText(s: string): string {
  return (s || '').replace(/\s+/g, '');
}

/**
 * 텍스트박스의 텍스트 추출
 */
function getTextboxText(txbxContent: any): string {
  const tNodes = getAllElementsLocal(txbxContent, 't');
  const texts: string[] = [];
  for (const t of tNodes) texts.push(t.textContent || '');
  return texts.join(' ').trim();
}

/**
 * Fillable 패턴인지 확인 (값을 채울 수 있는 텍스트박스)
 */
function isFillablePattern(text: string): boolean {
  const normalized = normalizeText(text);

  // ❌ 안내문 패턴 (이건 fillable이 아님, 무조건 제외)
  const guidePatterns = [
    /^※/,                    // ※로 시작 (안내문)
    /^예시:/,                 // 예시: 로 시작
    /사업계획서.*목차/,       // "사업계획서는 목차..." 같은 설명
    /작성.*요령/,             // "작성 요령..." 같은 설명
  ];

  if (guidePatterns.some(p => p.test(text) || p.test(normalized))) {
    return false; // 안내문은 무조건 fillable 아님
  }

  // ✅ Fillable 패턴
  const fillablePatterns = [
    /^OO+$/,                  // OOO, OOOO (단독)
    /^\.\.\.$/,               // ... (단독)
    /^\d+\.\d+$/,            // 00.00
    /^\d+개$/,               // 0개
    /^_+$/,                   // ___
  ];

  return fillablePatterns.some(p => p.test(normalized));
}

/**
 * Label 전용 패턴인지 확인 (라벨만 있는 텍스트박스, 슬롯 아님)
 */
function isLabelOnly(text: string): boolean {
  const normalized = normalizeText(text);

  // Label 패턴 (이런 것들은 슬롯으로 잡지 않음)
  const labelPatterns = [
    /창업아이템명/,
    /직업/,
    /기업.*명/,
    /예정.*명/,
    /성명/,
    /이름/,
    /소속/,
    /연락처/,
    /이메일/,
    /주소/,
  ];

  // 라벨 패턴이 있고 fillable 패턴은 없으면 label only
  const hasLabel = labelPatterns.some(p => p.test(normalized));
  const hasFillable = isFillablePattern(text);

  return hasLabel && !hasFillable;
}

export type SlotType = 'short_text' | 'long_text' | 'table_budget' | 'table_schedule' | 'image' | 'delete_only';

export interface TextboxSlot {
  key: string;
  label: string;
  kind: 'textbox';
  part: string;
  xmlPath: string;
  confidence: number;
  slotType?: SlotType;
  anchorLabel?: string;
  context?: string; // 주변 컨텍스트 (디버깅용)
}

/**
 * 텍스트박스 스캔
 */
export function scanTextboxes(dom: any, partName: string = 'word/document.xml'): TextboxSlot[] {
  const slots: TextboxSlot[] = [];

  // 모든 w:txbxContent 찾기
  const textboxes = getAllElementsLocal(dom.documentElement, 'txbxContent');

  console.log(`[textboxScanner] ${partName}: ${textboxes.length}개 텍스트박스 발견`);

  for (let i = 0; i < textboxes.length; i++) {
    const txbx = textboxes[i];
    const text = getTextboxText(txbx);

    // 빈 텍스트박스 스킵
    if (!text || text.length === 0) {
      continue;
    }

    // Label only 텍스트박스 스킵
    if (isLabelOnly(text)) {
      console.log(`[textboxScanner] Label only 스킵: "${text.substring(0, 30)}"`);
      continue;
    }

    // Fillable 패턴 체크
    if (isFillablePattern(text)) {
      const key = `TEXTBOX_${i + 1}`;
      const label = text.length > 30 ? `${text.substring(0, 30)}...` : text;

      // 슬롯 타입 추론 (대부분 short_text)
      const slotType: SlotType = text.length > 100 ? 'long_text' : 'short_text';

      slots.push({
        key,
        label,
        kind: 'textbox',
        part: partName,
        xmlPath: `${partName.replace('.xml', '')}:txbx${i}`,
        confidence: 0.8,
        slotType,
        context: text,
      });

      console.log(`[textboxScanner] ✓ Fillable 텍스트박스: ${key} - "${label}" (${slotType})`);
    } else {
      console.log(`[textboxScanner] Fillable 아님: "${text.substring(0, 30)}"`);
    }
  }

  console.log(`[textboxScanner] ${slots.length}개 fillable 텍스트박스 슬롯 추출`);

  return slots;
}
