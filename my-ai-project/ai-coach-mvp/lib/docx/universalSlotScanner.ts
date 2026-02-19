/**
 * lib/docx/universalSlotScanner.ts
 *
 * 범용 양식 분석 시스템 v2
 * - 어떤 DOCX 양식이든 자동으로 슬롯(채워야 할 곳)을 탐지
 * - 테이블 구조 분석: 헤더행+데이터행, 라벨-값 쌍 자동 인식
 * - 플레이스홀더/가이드 텍스트/예시 데이터 패턴 감지
 * - 텍스트박스 내 가이드 텍스트 감지
 */

import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';

export type SlotType = 'short_text' | 'long_text' | 'table_row' | 'image' | 'checkbox';

export interface UniversalSlot {
  key: string;           // 자동 생성된 슬롯 키 (라벨 기반)
  label: string;         // 라벨 텍스트 (사람이 읽을 수 있는)
  kind: 'universal';
  part: string;          // 파트 경로 (word/document.xml)
  xmlPath: string;       // 채워야 할 위치
  slotType: SlotType;
  context?: string;      // 주변 컨텍스트 (LLM에게 힌트)
  currentValue?: string; // 현재 값 (플레이스홀더 텍스트)
}

export interface ScanResult {
  slots: UniversalSlot[];
  stats: {
    totalTables: number;
    totalCells: number;
    fillableCells: number;
    textboxSlots: number;
    bodySectionSlots: number;
  };
}

// ============ 패턴 정의 ============

/**
 * 명확한 플레이스홀더 패턴 (셀 전체 텍스트 매칭)
 */
const PLACEHOLDER_PATTERNS = [
  /^※/,                         // ※로 시작 (안내문/예시)
  /^OO/,                         // OO로 시작 (OO학 박사, OO전자 등)
  /^oo/i,                        // oo 소문자
  /^\d{2}\.\d{2}$/,             // 00.00
  /^\d{2}\.\d{2}\.\d{2}$/,      // 00.00.00
  /\d{2}\.\d{2}\s*~\s*\d{2}\.\d{2}/, // 00.00 ~ 00.00
  /^_+$/,                        // ___
  /^\.{2,}$/,                    // ... 또는 …
  /^…$/,                         // 말줄임표
  /예시\s*[:：]/,                // "예시:" 또는 "예시："
  /^\(\s*\)$/,                   // ( )
  /^\[\s*\]$/,                   // [ ]
  /^○/,                          // ○○○, ○○전자 등
  /^□/,                          // □□□
  /'\d{2}\.\d{2}/,              // '00.00 (날짜 플레이스홀더)
  /\(0+개\)/,                    // (0개), (00개)
  /0+명/,                        // 00명
  /0+년/,                        // 00년
  /0+원/,                        // 0000원
];

/**
 * 예시/가이드 데이터 포함 패턴 (부분 매칭)
 */
const EXAMPLE_DATA_PATTERNS = [
  /^▪/,                          // ▪ 로 시작하는 항목
  /DMD소켓|전원IC/,               // 예시 품목들
  /금형제작|외주용역/,              // 예시 업무
  /시제품|프로토타입/,              // 예시 산출물
  /^<\s*.+\s*>$/,                // < 사진 또는 설계도 제목 >
];

/**
 * 확실한 라벨/헤더 키워드 (이 텍스트만 있으면 라벨로 판정)
 */
const HEADER_KEYWORDS = [
  '구분', '항목', '세부항목', '비목', '순번', '번호', 'No',
  '추진 내용', '추진 기간', '세부 내용', '산출 근거',
  '직위', '담당 업무', '보유 역량', '구성 상태', '협력 시기',
  '파트너명', '협업 방안', '정부지원사업비',
];

/**
 * 절대 채우면 안 되는 셀 (구조적 라벨)
 */
const STRUCTURAL_LABELS = [
  '합계', '소계', '총계',
  '비고', '참고',
];

// ============ 메인 함수 ============

export async function scanUniversalSlots(buffer: Buffer): Promise<ScanResult> {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml')?.async('text');

  if (!documentXml) {
    throw new Error('word/document.xml not found');
  }

  const dom = new DOMParser().parseFromString(documentXml, 'text/xml');
  const slots: UniversalSlot[] = [];
  const stats = {
    totalTables: 0,
    totalCells: 0,
    fillableCells: 0,
    textboxSlots: 0,
    bodySectionSlots: 0,
  };

  // 1. Body 섹션 스캔 먼저 (ㅇ/- 불릿 구조) — AI가 가장 먼저 처리하도록 최우선 배치
  const bodySectionSlots = scanBodySections(dom);
  slots.push(...bodySectionSlots);
  stats.bodySectionSlots = bodySectionSlots.length;

  // 2. 텍스트박스 스캔
  const textboxSlots = scanTextboxes(dom);
  slots.push(...textboxSlots);
  stats.textboxSlots = textboxSlots.length;

  // 3. 테이블 스캔
  const tables = getTopLevelTables(dom);
  stats.totalTables = tables.length;

  for (let tIdx = 0; tIdx < tables.length; tIdx++) {
    const table = tables[tIdx];
    const tableSlots = scanTable(table, tIdx + 1);
    slots.push(...tableSlots);

    const rows = getDirectChildren(table, 'tr');
    for (const row of rows) {
      stats.totalCells += getDirectChildren(row, 'tc').length;
    }
    stats.fillableCells += tableSlots.length;
  }

  console.log(`[UniversalScanner] 스캔 완료: ${slots.length}개 슬롯 발견`);
  console.log(`[UniversalScanner] 테이블: ${stats.totalTables}, 셀: ${stats.totalCells}, 채울곳: ${stats.fillableCells}, 텍스트박스: ${stats.textboxSlots}, 본문섹션: ${stats.bodySectionSlots}`);

  return { slots, stats };
}

// ============ 테이블 스캔 ============

function scanTable(table: any, tableIndex: number): UniversalSlot[] {
  const rows = getDirectChildren(table, 'tr');
  if (rows.length === 0) return [];

  const tableType = classifyTable(rows);

  switch (tableType) {
    case 'single_cell_notice':
      return scanSingleCellTable(rows, tableIndex);
    case 'label_value_2col':
      return scanLabelValueTable(rows, tableIndex);
    case 'header_data_grid':
      return scanHeaderDataGrid(rows, tableIndex);
    default:
      return scanMixedTable(rows, tableIndex);
  }
}

function classifyTable(rows: any[]): 'single_cell_notice' | 'label_value_2col' | 'header_data_grid' | 'mixed' {
  if (rows.length === 0) return 'mixed';

  if (rows.length === 1) {
    const cells = getDirectChildren(rows[0], 'tc');
    if (cells.length === 1) return 'single_cell_notice';
  }

  const firstRowCells = getDirectChildren(rows[0], 'tc');
  const colCount = firstRowCells.length;

  if (colCount >= 2 && colCount <= 4) {
    let labelValueCount = 0;
    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      const cells = getDirectChildren(rows[rIdx], 'tc');
      if (cells.length >= 2) {
        const c0Text = getCellText(cells[0]).trim();
        const c1Text = getCellText(cells[1]).trim();
        if (c0Text.length > 0 && c0Text.length < 40 && c1Text.length > c0Text.length) {
          labelValueCount++;
        }
      }
    }
    if (labelValueCount >= Math.ceil(rows.length * 0.5)) {
      return 'label_value_2col';
    }
  }

  if (colCount >= 3) {
    const firstRowTexts = firstRowCells.map((c: any) => getCellText(c).trim());
    const allShort = firstRowTexts.every((t: string) => t.length > 0 && t.length < 20);
    const hasHeaderKeyword = firstRowTexts.some((t: string) =>
      HEADER_KEYWORDS.some(kw => t.includes(kw))
    );
    if (allShort && hasHeaderKeyword) {
      return 'header_data_grid';
    }
  }

  return 'mixed';
}

function scanSingleCellTable(rows: any[], tableIndex: number): UniversalSlot[] {
  const cell = getDirectChildren(rows[0], 'tc')[0];
  if (!cell) return [];

  const text = getCellText(cell).trim();
  if (!text || text.length === 0) return [];

  if (text.startsWith('※')) {
    return [{
      key: `TABLE${tableIndex}_NOTICE`,
      label: `안내문 (테이블 ${tableIndex})`,
      kind: 'universal',
      part: 'word/document.xml',
      xmlPath: `document:table${tableIndex}:r0:c0`,
      slotType: 'long_text',
      currentValue: text.substring(0, 100),
    }];
  }

  return [];
}

function scanLabelValueTable(rows: any[], tableIndex: number): UniversalSlot[] {
  const slots: UniversalSlot[] = [];

  let startRow = 0;
  if (rows.length > 1) {
    const firstRowCells = getDirectChildren(rows[0], 'tc');
    const firstRowTexts = firstRowCells.map((c: any) => getCellText(c).trim());
    const allShort = firstRowTexts.every((t: string) => t.length > 0 && t.length < 20);
    const hasHeaderKeyword = firstRowTexts.some((t: string) =>
      HEADER_KEYWORDS.some(kw => t.includes(kw))
    );
    if (allShort && hasHeaderKeyword) {
      startRow = 1;
    }
  }

  for (let rIdx = startRow; rIdx < rows.length; rIdx++) {
    const cells = getDirectChildren(rows[rIdx], 'tc');

    for (let cIdx = 0; cIdx < cells.length; cIdx++) {
      const cellText = getCellText(cells[cIdx]).trim();

      if (cIdx === 0 && cells.length >= 2) {
        if (cellText.length > 0 && cellText.length < 40) continue;
      }

      if (!cellText || cellText.length === 0) continue;
      if (isStructuralLabel(cellText)) continue;

      const label = findLabel(rows, rIdx, cIdx, cells);
      const slotType = inferSlotType(cellText, label);
      const key = generateSlotKey(label, tableIndex, rIdx, cIdx);

      slots.push({
        key,
        label: label || `테이블${tableIndex}_행${rIdx}_열${cIdx}`,
        kind: 'universal',
        part: 'word/document.xml',
        xmlPath: `document:table${tableIndex}:r${rIdx}:c${cIdx}`,
        slotType,
        context: getContext(rows, rIdx, cIdx),
        currentValue: cellText.substring(0, 150),
      });
    }
  }

  return slots;
}

function scanHeaderDataGrid(rows: any[], tableIndex: number): UniversalSlot[] {
  const slots: UniversalSlot[] = [];
  if (rows.length < 2) return slots;

  const headerCells = getDirectChildren(rows[0], 'tc');
  const headers = headerCells.map((c: any) => getCellText(c).trim());

  for (let rIdx = 1; rIdx < rows.length; rIdx++) {
    const cells = getDirectChildren(rows[rIdx], 'tc');

    for (let cIdx = 0; cIdx < cells.length; cIdx++) {
      const cellText = getCellText(cells[cIdx]).trim();

      if (isStructuralLabel(cellText)) continue;

      if (!cellText || cellText.length === 0) {
        const headerLabel = headers[cIdx] || `열${cIdx}`;
        const key = generateSlotKey(headerLabel, tableIndex, rIdx, cIdx);

        slots.push({
          key,
          label: headerLabel,
          kind: 'universal',
          part: 'word/document.xml',
          xmlPath: `document:table${tableIndex}:r${rIdx}:c${cIdx}`,
          slotType: 'short_text',
          context: `헤더: ${headerLabel} | 행: ${rIdx}`,
        });
        continue;
      }

      if (cIdx === 0 && (/^\d+$/.test(cellText) || cellText === '…' || cellText === '...')) {
        continue;
      }

      const headerLabel = headers[cIdx] || `열${cIdx}`;
      const key = generateSlotKey(headerLabel, tableIndex, rIdx, cIdx);

      slots.push({
        key,
        label: headerLabel,
        kind: 'universal',
        part: 'word/document.xml',
        xmlPath: `document:table${tableIndex}:r${rIdx}:c${cIdx}`,
        slotType: inferSlotType(cellText, headerLabel),
        context: `헤더: ${headerLabel} | 행: ${rIdx}`,
        currentValue: cellText.substring(0, 100),
      });
    }
  }

  return slots;
}

function scanMixedTable(rows: any[], tableIndex: number): UniversalSlot[] {
  const slots: UniversalSlot[] = [];

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const cells = getDirectChildren(rows[rIdx], 'tc');

    for (let cIdx = 0; cIdx < cells.length; cIdx++) {
      const cellText = getCellText(cells[cIdx]).trim();
      if (!cellText) continue;

      if (isFillableContent(cellText)) {
        const label = findLabel(rows, rIdx, cIdx, cells);
        const slotType = inferSlotType(cellText, label);
        const key = generateSlotKey(label, tableIndex, rIdx, cIdx);

        slots.push({
          key,
          label: label || `테이블${tableIndex}_행${rIdx}_열${cIdx}`,
          kind: 'universal',
          part: 'word/document.xml',
          xmlPath: `document:table${tableIndex}:r${rIdx}:c${cIdx}`,
          slotType,
          context: getContext(rows, rIdx, cIdx),
          currentValue: cellText.substring(0, 150),
        });
      }
    }
  }

  return slots;
}

// ============ 판단 로직 ============

function isFillableContent(text: string): boolean {
  if (!text || text.length === 0) return false;
  const normalized = text.replace(/\s+/g, '');

  if (isStructuralLabel(text)) return false;

  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(text) || pattern.test(normalized)) return true;
  }

  for (const pattern of EXAMPLE_DATA_PATTERNS) {
    if (pattern.test(text)) return true;
  }

  if (normalized.length > 50) {
    const hasHeaderKeyword = HEADER_KEYWORDS.some(kw => text.includes(kw));
    if (!hasHeaderKeyword) return true;
  }

  if (/OO|○○|00명|00년|00개/.test(text)) return true;

  return false;
}

function isStructuralLabel(text: string): boolean {
  const trimmed = text.trim();
  return STRUCTURAL_LABELS.some(label => trimmed === label);
}

function findLabel(rows: any[], rIdx: number, cIdx: number, cells: any[]): string {
  if (cIdx > 0) {
    const leftText = getCellText(cells[cIdx - 1]).trim();
    if (leftText.length > 0 && leftText.length < 40 && !isFillableContent(leftText)) {
      return cleanLabel(leftText);
    }
  }

  if (rIdx > 0) {
    const prevCells = getDirectChildren(rows[rIdx - 1], 'tc');
    if (cIdx < prevCells.length) {
      const topText = getCellText(prevCells[cIdx]).trim();
      if (topText.length > 0 && topText.length < 40 && !isFillableContent(topText)) {
        return cleanLabel(topText);
      }
    }
  }

  if (rIdx > 0) {
    const headerCells = getDirectChildren(rows[0], 'tc');
    if (cIdx < headerCells.length) {
      const headerText = getCellText(headerCells[cIdx]).trim();
      if (headerText.length > 0 && headerText.length < 40) {
        return cleanLabel(headerText);
      }
    }
  }

  return '';
}

// ============ 텍스트박스 스캔 ============

function scanTextboxes(dom: any): UniversalSlot[] {
  const slots: UniversalSlot[] = [];
  const textboxes = getAllElements(dom, 'txbxContent');

  const seenTexts = new Set<string>();
  let slotIndex = 0;

  for (let i = 0; i < textboxes.length; i++) {
    const txbx = textboxes[i];
    const text = getElementText(txbx).trim();

    if (!text || text.length === 0) continue;

    const textKey = text.substring(0, 80);
    if (seenTexts.has(textKey)) continue;
    seenTexts.add(textKey);

    if (isTextboxFillable(text)) {
      const label = findTextboxLabel(textboxes, i, text);

      const contentSignature = text.substring(0, 60).replace(/[^가-힣a-zA-Z0-9]/g, '').substring(0, 30);

      slots.push({
        key: `TEXTBOX_${slotIndex}`,
        label: label || `텍스트박스 ${slotIndex + 1}`,
        kind: 'universal',
        part: 'word/document.xml',
        xmlPath: `document:txbx_match:${contentSignature}`,
        slotType: text.length > 100 ? 'long_text' : 'short_text',
        currentValue: text.substring(0, 150),
      });
      slotIndex++;
    }
  }

  return slots;
}

function isTextboxFillable(text: string): boolean {
  if (text.startsWith('※')) return true;
  if (/^OO|^○○|^OOOOO/.test(text)) return true;
  if (/^\.{2,}$|^…$/.test(text.trim())) return true;

  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(text)) return true;
  }

  return false;
}

function findTextboxLabel(textboxes: any[], currentIndex: number, currentText: string): string {
  for (let offset = 1; offset <= 3 && currentIndex + offset < textboxes.length; offset++) {
    const nearbyText = getElementText(textboxes[currentIndex + offset]).trim();
    if (nearbyText.length < 60 && !nearbyText.startsWith('※') && /^\d+\./.test(nearbyText)) {
      return cleanLabel(nearbyText.split('_')[0]);
    }
  }

  if (currentText.startsWith('※')) {
    const firstLine = currentText.split('\n')[0].substring(2, 40).trim();
    if (firstLine.length > 3) return firstLine;
  }

  return '';
}

// ============ Body 섹션 스캔 ============

function scanBodySections(dom: any): UniversalSlot[] {
  const slots: UniversalSlot[] = [];
  const body = getAllElements(dom, 'body')[0];
  if (!body) return slots;

  const kids = body.childNodes || [];

  interface BodySection {
    titleIndex: number;
    titleText: string;
    guideIndex: number;
    contentStart: number;
    contentEnd: number;
    circleCount: number;
    bulletCount: number;
  }

  const sections: BodySection[] = [];
  let currentSection: BodySection | null = null;

  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType !== 1) continue;

    const tag = getLocalName(n);
    const text = getElementText(n).trim();
    const hasTxbx = containsElement(n, 'txbxContent');

    if (hasTxbx && /^\d+\.\s/.test(text)) {
      if (currentSection && currentSection.contentStart > 0 &&
          (currentSection.circleCount > 0 || currentSection.bulletCount > 0)) {
        sections.push(currentSection);
      }

      const halfLen = Math.floor(text.length / 2);
      const cleanTitle = text.substring(0, halfLen) || text;

      currentSection = {
        titleIndex: i,
        titleText: cleanTitle.substring(0, 80),
        guideIndex: -1,
        contentStart: -1,
        contentEnd: -1,
        circleCount: 0,
        bulletCount: 0,
      };
      continue;
    }

    if (currentSection && hasTxbx && text.includes('※')) {
      currentSection.guideIndex = i;
      continue;
    }

    if (currentSection && tag === 'p' && !hasTxbx) {
      const numPr = getParagraphNumPr(n);
      const isCircle = text === 'ㅇ' || text === '○';
      const isEmpty = !text || text.length === 0;
      const isBullet = numPr !== null;
      const isGuideText = text.startsWith('※');

      if (isCircle || isEmpty || isBullet || isGuideText) {
        if (currentSection.contentStart === -1) {
          currentSection.contentStart = i;
        }
        currentSection.contentEnd = i;
        if (isCircle) currentSection.circleCount++;
        if (isBullet) currentSection.bulletCount++;
        continue;
      }
    }

    if (currentSection && (tag === 'tbl' || (hasTxbx && !text.includes('※')) ||
        (tag === 'p' && !hasTxbx && text.length > 0 && text !== 'ㅇ' && text !== '○' && !text.startsWith('※')))) {
      if (currentSection.contentStart > 0 &&
          (currentSection.circleCount > 0 || currentSection.bulletCount > 0)) {
        sections.push(currentSection);
      }
      currentSection = null;
    }
  }

  if (currentSection && currentSection.contentStart > 0 &&
      (currentSection.circleCount > 0 || currentSection.bulletCount > 0)) {
    sections.push(currentSection);
  }

  for (let sIdx = 0; sIdx < sections.length; sIdx++) {
    const section = sections[sIdx];

    const titleSignature = section.titleText
      .substring(0, 60)
      .replace(/[^가-힣a-zA-Z0-9]/g, '')
      .substring(0, 30);

    const label = section.titleText
      .replace(/\d+\.\s*/, '')
      .replace(/_/g, ' - ')
      .trim();

    slots.push({
      key: `BODY_SECTION_${sIdx}`,
      label: label || `본문 섹션 ${sIdx + 1}`,
      kind: 'universal',
      part: 'word/document.xml',
      xmlPath: `document:body_section:${titleSignature}`,
      slotType: 'long_text',
      context: `섹션 "${section.titleText}" 의 본문 작성 영역 (ㅇ ${section.circleCount}개, 불릿 ${section.bulletCount}개)`,
      currentValue: `[ㅇ 마커 ${section.circleCount}개와 - 불릿 ${section.bulletCount}개로 구성된 빈 작성 영역]`,
    });

    console.log(`[UniversalScanner] Body 섹션 발견: "${section.titleText}" (body[${section.contentStart}..${section.contentEnd}], ㅇ:${section.circleCount}, bullet:${section.bulletCount})`);
  }

  return slots;
}

function containsElement(node: any, localName: string): boolean {
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (!n) continue;
    if (getLocalName(n) === localName) return true;
    if (n.childNodes) {
      for (let i = 0; i < n.childNodes.length; i++) {
        if (n.childNodes[i].nodeType === 1) stack.push(n.childNodes[i]);
      }
    }
  }
  return false;
}

function getParagraphNumPr(p: any): { numId: string; ilvl: string } | null {
  if (!p.childNodes) return null;
  for (let i = 0; i < p.childNodes.length; i++) {
    const child = p.childNodes[i];
    if (child.nodeType === 1 && getLocalName(child) === 'pPr') {
      for (let j = 0; j < child.childNodes.length; j++) {
        const gc = child.childNodes[j];
        if (gc.nodeType === 1 && getLocalName(gc) === 'numPr') {
          let numId = '', ilvl = '';
          for (let k = 0; k < gc.childNodes.length; k++) {
            const ggc = gc.childNodes[k];
            if (ggc.nodeType !== 1) continue;
            if (getLocalName(ggc) === 'numId') numId = ggc.getAttribute('w:val') || '';
            if (getLocalName(ggc) === 'ilvl') ilvl = ggc.getAttribute('w:val') || '';
          }
          return { numId, ilvl };
        }
      }
    }
  }
  return null;
}

// ============ 유틸리티 ============

function cleanLabel(text: string): string {
  return text
    .replace(/[\s\n\r]+/g, ' ')
    .replace(/[()（）\[\]【】]/g, '')
    .trim()
    .substring(0, 50);
}

function inferSlotType(text: string, label: string): SlotType {
  const combined = (text + ' ' + label).toLowerCase();

  if (combined.includes('이미지') || combined.includes('사진') || combined.includes('로고') || combined.includes('설계도')) {
    return 'image';
  }

  if (text.length < 30 || /^\d/.test(text.trim())) {
    return 'short_text';
  }

  return 'long_text';
}

function generateSlotKey(label: string, tableIndex: number, rowIndex: number, colIndex: number): string {
  if (label) {
    const cleanKey = label
      .replace(/[^가-힣a-zA-Z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .toUpperCase()
      .substring(0, 30);

    if (cleanKey.length > 2) {
      return `${cleanKey}_T${tableIndex}R${rowIndex}`;
    }
  }
  return `TABLE${tableIndex}_ROW${rowIndex}_COL${colIndex}`;
}

function getContext(rows: any[], rIdx: number, cIdx: number): string {
  const contexts: string[] = [];

  const currentRow = rows[rIdx];
  const cells = getDirectChildren(currentRow, 'tc');
  for (let i = 0; i < Math.min(cells.length, 4); i++) {
    if (i !== cIdx) {
      const text = getCellText(cells[i]).trim().substring(0, 40);
      if (text && !text.startsWith('※')) {
        contexts.push(text);
      }
    }
  }

  if (rIdx > 0 && rows[0]) {
    const headerCells = getDirectChildren(rows[0], 'tc');
    if (cIdx < headerCells.length) {
      const headerText = getCellText(headerCells[cIdx]).trim().substring(0, 30);
      if (headerText) contexts.push(`헤더: ${headerText}`);
    }
  }

  return contexts.join(' | ');
}

// ============ DOM 헬퍼 ============

function getTopLevelTables(dom: any): any[] {
  const body = getAllElements(dom, 'body')[0];
  if (!body) return [];

  const out: any[] = [];
  const kids = body.childNodes || [];

  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType !== 1) continue;

    const localName = getLocalName(n);
    if (localName === 'tbl') {
      out.push(n);
    } else if (localName === 'sdt') {
      const sdtContents = getDirectChildren(n, 'sdtContent');
      if (sdtContents.length > 0) {
        const sdtContent = sdtContents[0];
        const sdtKids = sdtContent.childNodes || [];
        for (let j = 0; j < sdtKids.length; j++) {
          const m = sdtKids[j];
          if (m.nodeType === 1 && getLocalName(m) === 'tbl') {
            out.push(m);
          }
        }
      }
    }
  }
  return out;
}

function getDirectChildren(parent: any, localName: string): any[] {
  const out: any[] = [];
  if (!parent?.childNodes) return out;

  for (let i = 0; i < parent.childNodes.length; i++) {
    const n = parent.childNodes[i];
    if (n.nodeType === 1 && getLocalName(n) === localName) {
      out.push(n);
    }
  }
  return out;
}

function getAllElements(dom: any, localName: string): any[] {
  const out: any[] = [];
  const root = dom?.documentElement;
  if (!root) return out;

  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (!n) continue;
    if (getLocalName(n) === localName) out.push(n);
    if (n.childNodes) {
      for (let i = 0; i < n.childNodes.length; i++) {
        stack.push(n.childNodes[i]);
      }
    }
  }
  return out;
}

function getLocalName(node: any): string {
  const name = node?.tagName || node?.nodeName || '';
  const idx = name.indexOf(':');
  return idx >= 0 ? name.slice(idx + 1) : name;
}

function getCellText(tc: any): string {
  return getElementText(tc);
}

function getElementText(node: any): string {
  const texts: string[] = [];
  const stack = [node];

  while (stack.length > 0) {
    const n = stack.pop();
    if (!n) continue;

    if (getLocalName(n) === 't') {
      texts.push(n.textContent || '');
    }

    if (n.childNodes) {
      for (let i = n.childNodes.length - 1; i >= 0; i--) {
        const child = n.childNodes[i];
        if (child.nodeType === 1) {
          stack.push(child);
        }
      }
    }
  }

  return texts.join('');
}
