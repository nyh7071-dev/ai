/**
 * lib/docx/templateAdapters.ts
 *
 * 템플릿 어댑터 시스템
 * - SDT가 부족한 템플릿을 보완
 * - 템플릿 타입 감지
 * - 템플릿별 슬롯 추출 규칙
 */

import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import type { SDTSlot } from './sdtScanner';

export type SlotType = 'short_text' | 'long_text' | 'table_budget' | 'table_schedule' | 'image' | 'delete_only';

export interface AdapterSlot {
  key: string;
  label: string;
  kind: 'adapter';
  part: string;
  xmlPath: string;
  confidence: number;
  slotType?: SlotType;
  anchorLabel?: string; // 라벨 앵커 (재탐색용)
}

export interface AdapterContext {
  buffer: Buffer;
  dom: any;
  templateType: string;
  existingSlots: SDTSlot[];
}

export interface TemplateAdapter {
  name: string;
  match: (context: AdapterContext) => number; // returns score 0..1
  extract: (context: AdapterContext) => Promise<AdapterSlot[]>;
}

export interface AdapterResult {
  slots: (SDTSlot | AdapterSlot)[];
  adaptersUsed: string[];
}

/**
 * 템플릿 타입 감지
 */
export async function detectTemplateType(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml')?.async('text');

  if (!documentXml) {
    return 'unknown';
  }

  const text = documentXml.toLowerCase();

  // 시그니처 기반 감지
  if (text.includes('명칭') && text.includes('범주') && text.includes('소재지')) {
    return 'pre-startup-summary';
  }

  // 다른 템플릿 타입 추가 가능
  // if (text.includes('사업계획서')) return 'business-plan';
  // ...

  return 'unknown';
}

/**
 * 어댑터 적용
 */
export async function applyAdapters(
  buffer: Buffer,
  templateType: string,
  existingSlots: SDTSlot[]
): Promise<AdapterResult> {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml')?.async('text');

  if (!documentXml) {
    throw new Error('document.xml not found');
  }

  const dom = new DOMParser().parseFromString(documentXml, 'text/xml');

  const context: AdapterContext = {
    buffer,
    dom,
    templateType,
    existingSlots,
  };

  // 등록된 어댑터들
  const adapters: TemplateAdapter[] = [
    summaryTableAdapter,
    // 추가 어댑터를 여기에 등록
  ];

  // 어댑터 매칭 및 실행
  const adaptersUsed: string[] = [];
  let allSlots: (SDTSlot | AdapterSlot)[] = [...existingSlots];

  // 점수 계산 및 정렬
  const scored = adapters.map(adapter => ({
    adapter,
    score: adapter.match(context),
  })).sort((a, b) => b.score - a.score);

  console.log('[Template Adapters] 어댑터 점수:');
  scored.forEach(({ adapter, score }) => {
    console.log(`  - ${adapter.name}: ${score.toFixed(2)}`);
  });

  // 높은 점수부터 적용
  for (const { adapter, score } of scored) {
    if (score > 0.5) { // 임계치
      console.log(`[Template Adapters] ${adapter.name} 적용 중...`);
      const adapterSlots = await adapter.extract(context);
      console.log(`[Template Adapters] ${adapter.name}: ${adapterSlots.length}개 슬롯 추출`);

      // ✅ summaryTableAdapter가 11개 뽑으면 이걸 최종으로 확정(기존 슬롯 버림)
      if (adapter.name === 'summaryTableAdapter' && adapterSlots.length >= 11) {
        adaptersUsed.push(adapter.name);
        console.log(`[Template Adapters] ${adapter.name} 11개 슬롯 확정, 기존 슬롯 무시`);
        return { slots: adapterSlots, adaptersUsed };
      }

      // 기본 merge 로직 (그 외 어댑터)
      const existingKeys = new Set(allSlots.map(s => s.key));
      const newSlots = adapterSlots.filter(s => !existingKeys.has(s.key));

      allSlots = [...allSlots, ...newSlots];
      adaptersUsed.push(adapter.name);
    }
  }

  return {
    slots: allSlots,
    adaptersUsed,
  };
}

/**
 * 요약 테이블 어댑터
 * "예비창업패키지 요약서" 템플릿용
 *
 * 행별 셀 구조: [4,2,2,2,2,2,3,3]
 * - Row 0 (4개): 명칭/값, 범주/값 → 2개 슬롯
 * - Row 1-5 (2개): 라벨/값 → 5개 슬롯
 * - Row 6 (3개): 라벨, 이미지1, 이미지2 → 2개 슬롯
 * - Row 7 (3개): 빈칸, 제목1, 제목2 → 2개 슬롯
 * 총 11개 슬롯
 */
export const summaryTableAdapter: TemplateAdapter = {
  name: 'summaryTableAdapter',

  match: (context: AdapterContext): number => {
    // ✅ fillDocx와 동일한 방식으로 최상위 테이블만 수집 (중첩 제외!)
    const tables = getTopLevelTablesLocal(context.dom);
    console.log(`[summaryTableAdapter] 최상위 테이블 개수: ${tables.length}`);

    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      const rows = getDirectChildrenLocal(table, 'tr');
      if (rows.length === 0) continue;

      const firstRow = rows[0];
      const cells = getDirectChildrenLocal(firstRow, 'tc');
      const cellTexts = cells.map((c: any) => cellText(c));

      console.log(`[summaryTableAdapter] 테이블 #${i + 1} 첫 행: [${cellTexts.join(', ')}]`);

      const hasName = cellTexts.some((t: string) => t.includes('명칭'));
      const hasCategory = cellTexts.some((t: string) => t.includes('범주'));

      if (hasName && hasCategory) {
        console.log(`[summaryTableAdapter] ✓ 시그니처 매칭! 테이블 #${i + 1}`);
        return 1.0;
      }
    }

    console.log('[summaryTableAdapter] 시그니처 미매칭');
    return 0;
  },

  extract: async (context: AdapterContext): Promise<AdapterSlot[]> => {
    // ✅ fillDocx와 동일한 방식으로 최상위 테이블만 수집 (중첩 제외!)
    const tables = getTopLevelTablesLocal(context.dom);
    console.log(`[summaryTableAdapter] 최상위 테이블 개수: ${tables.length}`);

    let targetTable: any = null;
    let tableIndex = -1;

    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      const rows = getDirectChildrenLocal(table, 'tr');
      if (rows.length === 0) continue;

      const firstRow = rows[0];
      const cells = getDirectChildrenLocal(firstRow, 'tc');
      const cellTexts = cells.map((c: any) => cellText(c));

      const hasName = cellTexts.some((t: string) => t.includes('명칭'));
      const hasCategory = cellTexts.some((t: string) => t.includes('범주'));

      if (hasName && hasCategory) {
        targetTable = table;
        tableIndex = i + 1; // 1-based (fillDocx와 동일한 인덱스!)
        console.log(`[summaryTableAdapter] 요약 테이블 발견: 테이블 #${tableIndex}`);
        break;
      }
    }

    if (!targetTable) {
      console.error('[summaryTableAdapter] 요약 테이블을 찾을 수 없음');
      return [];
    }

    const allRows = getDirectChildrenLocal(targetTable, 'tr');
    const rowCellCounts = allRows.map((r: any) => getDirectChildrenLocal(r, 'tc').length);
    console.log(`[summaryTableAdapter] 행별 셀 개수: [${rowCellCounts.join(', ')}]`);

    const slots: AdapterSlot[] = [];

    // Row 0 - short_text (명칭, 범주)
    // 원본 구조: [명칭(논리0)][값(논리1)][범주(gridSpan=2, 논리2-3)][값(논리4)]
    slots.push(
      createSlot('SUMMARY_NAME', '명칭', tableIndex, 0, 1, 'short_text', '명칭'),
      createSlot('SUMMARY_CATEGORY', '범주', tableIndex, 0, 4, 'short_text', '범주')  // col=4 (범주 라벨이 gridSpan=2이므로)
    );

    // Row 1~5 - long_text (본문)
    const row1to5Mapping = [
      { row: 1, key: 'SUMMARY_OVERVIEW', label: '아이템개요', anchor: '아이템개요' },
      { row: 2, key: 'PROBLEM', label: '문제인식(Problem)', anchor: '문제인식' },
      { row: 3, key: 'SOLUTION', label: '실현가능성(Solution)', anchor: '실현가능성' },
      { row: 4, key: 'SCALEUP', label: '성장전략(Scale-up)', anchor: '성장전략' },
      { row: 5, key: 'TEAM', label: '팀구성(Team)', anchor: '팀구성' },
    ];
    for (const m of row1to5Mapping) {
      slots.push(createSlot(m.key, m.label, tableIndex, m.row, 1, 'long_text', m.anchor));
    }

    // Row 6 - image
    slots.push(
      createSlot('IMAGE_1', '이미지1', tableIndex, 6, 1, 'image'),
      createSlot('IMAGE_2', '이미지2', tableIndex, 6, 2, 'image')
    );

    // Row 7 - short_text (이미지 제목)
    slots.push(
      createSlot('IMAGE_TITLE_1', '이미지 제목1', tableIndex, 7, 1, 'short_text'),
      createSlot('IMAGE_TITLE_2', '이미지 제목2', tableIndex, 7, 2, 'short_text')
    );

    console.log(`[summaryTableAdapter] 슬롯 개수: ${slots.length} (기대: 11)`);
    console.log(`[summaryTableAdapter] 슬롯 키: [${slots.map(s => s.key).join(', ')}]`);

    return slots;
  },
};

/**
 * 슬롯 생성 헬퍼
 */
function createSlot(
  key: string,
  label: string,
  tableIndex: number,
  row: number,
  col: number,
  slotType: SlotType = 'long_text',
  anchorLabel?: string
): AdapterSlot {
  return {
    key,
    label,
    kind: 'adapter',
    part: 'word/document.xml',
    xmlPath: `document:table${tableIndex}:r${row}:c${col}`,
    confidence: 0.9,
    slotType,
    anchorLabel: anchorLabel || label,
  };
}

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
 * 직계 자식 중 특정 local name만 가져오기
 */
function getDirectChildrenLocal(parent: any, local: string): any[] {
  const out: any[] = [];
  if (!parent?.childNodes) return out;
  for (let i = 0; i < parent.childNodes.length; i++) {
    const n = parent.childNodes[i];
    if (isLocal(n, local)) out.push(n);
  }
  return out;
}

/**
 * DOM 전체에서 특정 local name의 모든 요소 가져오기
 */
function getAllElementsLocal(dom: any, local: string): any[] {
  const out: any[] = [];
  const root = dom?.documentElement;
  if (!root) return out;

  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (!n) continue;
    if (isLocal(n, local)) out.push(n);
    if (n.childNodes && n.childNodes.length) {
      for (let i = 0; i < n.childNodes.length; i++) stack.push(n.childNodes[i]);
    }
  }
  return out;
}

/**
 * 최상위 테이블만 수집 (fillDocx.ts의 getTopLevelTables와 동일한 로직!)
 * - w:body 직계 자식 w:tbl
 * - w:body > w:sdt > w:sdtContent 안의 w:tbl (Content Control 래퍼)
 * 중첩 테이블(w:tbl 안의 w:tbl)은 제외
 */
function getTopLevelTablesLocal(dom: any): any[] {
  // body 찾기 (localName 기반)
  const allBodies = getAllElementsLocal(dom, 'body');
  const body = allBodies[0];
  if (!body) return [];

  const out: any[] = [];
  const kids = body.childNodes || [];

  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType !== 1) continue;

    if (isLocal(n, 'tbl')) {
      out.push(n);
    } else if (isLocal(n, 'sdt')) {
      // w:sdt > w:sdtContent 안의 w:tbl도 수집
      const sdtContents = getDirectChildrenLocal(n, 'sdtContent');
      if (sdtContents.length > 0) {
        const sdtContent = sdtContents[0];
        const sdtKids = sdtContent.childNodes || [];
        for (let j = 0; j < sdtKids.length; j++) {
          const m = sdtKids[j];
          if (m.nodeType === 1 && isLocal(m, 'tbl')) {
            out.push(m);
          }
        }
      }
    }
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
 * 셀 텍스트 추출 (local name 기반)
 */
function cellText(tc: any): string {
  const tNodes = getAllElementsLocal({ documentElement: tc }, 't');
  const texts: string[] = [];
  for (const t of tNodes) texts.push(t.textContent || '');
  return normalizeText(texts.join(''));
}

