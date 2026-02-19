/**
 * DOCX 템플릿에 write_ops를 적용하여 filled DOCX 생성
 *
 * xmlPath 형식: document:table{n}:r{row}:c{col} (tableId는 1-based)
 *
 * @example
 * const result = await fillDocx(templateBuffer, [
 *   { xmlPath: "document:table5:r1:c1", value: "홍길동" },
 *   { xmlPath: "document:table6:r0:c0", value: "AI 플랫폼" }
 * ]);
 * // result.buffer → filled DOCX buffer
 * // result.summary → { ok: 2, fail: 0, ... }
 */

import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { cleanupCell, cleanupTextbox } from './cleanup';

export type SlotType = 'short_text' | 'long_text' | 'table_budget' | 'table_schedule' | 'image' | 'delete_only';

export interface WriteOp {
  xmlPath: string;
  value: any;
  key?: string;
  slot?: string;
  slotType?: SlotType;
  anchorLabel?: string;
}

export interface FillSummary {
  ok: number;
  fail: number;
  badPath: number;
  noTable: number;
  noRow: number;
  noCell: number;
  topTables: number;
}

export interface FillDocxOptions {
  skipEmpty?: boolean; // true면 빈 값 ops 건너뜀
}

export interface FillDocxResult {
  buffer: Buffer;
  summary: FillSummary;
}

/**
 * xmlPath 파싱
 */
type ParsedPath =
  | { tableId: number; row: number; col: number }
  | { textboxId: number }
  | { textboxContentMatch: string }
  | { bodySectionTitle: string };

function parseXmlPath(xmlPath: string): ParsedPath | null {
  // 테이블 경로
  const tableMatch = /^document:table(\d+):r(\d+):c(\d+)$/.exec(xmlPath);
  if (tableMatch) {
    return {
      tableId: Number(tableMatch[1]),
      row: Number(tableMatch[2]),
      col: Number(tableMatch[3]),
    };
  }

  // 텍스트박스 경로 (인덱스 기반 - 레거시)
  const textboxMatch = /^document:txbx(\d+)$/.exec(xmlPath);
  if (textboxMatch) {
    return {
      textboxId: Number(textboxMatch[1]),
    };
  }

  // 텍스트박스 경로 (텍스트 내용 매칭)
  const textboxContentMatch = /^document:txbx_match:(.+)$/.exec(xmlPath);
  if (textboxContentMatch) {
    return {
      textboxContentMatch: textboxContentMatch[1],
    };
  }

  // Body 섹션 경로 (섹션 타이틀 매칭)
  const bodySectionMatch = /^document:body_section:(.+)$/.exec(xmlPath);
  if (bodySectionMatch) {
    return {
      bodySectionTitle: bodySectionMatch[1],
    };
  }

  return null;
}

/**
 * 부모의 직계 자식 중 tagName과 일치하는 노드들 반환
 */
function directChildrenByTag(parent: any, tagName: string): any[] {
  const out: any[] = [];
  const kids = parent.childNodes || [];
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType === 1 && n.tagName === tagName) {
      out.push(n);
    }
  }
  return out;
}

/**
 * 부모의 직계 자식 중 tagName과 일치하는 첫 번째 노드 반환
 */
function getFirstDirectChild(parent: any, tagName: string): any | null {
  const kids = parent.childNodes || [];
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType === 1 && n.tagName === tagName) {
      return n;
    }
  }
  return null;
}

/**
 * w:tc의 gridSpan 값 가져오기 (없으면 1)
 */
function getGridSpan(tc: any): number {
  const tcPr = getFirstDirectChild(tc, 'w:tcPr');
  if (!tcPr) return 1;

  const gridSpan = getFirstDirectChild(tcPr, 'w:gridSpan');
  if (!gridSpan) return 1;

  const val = gridSpan.getAttribute('w:val') || gridSpan.getAttribute('val');
  if (!val) return 1;

  const n = Number(val);
  return isNaN(n) || n < 1 ? 1 : n;
}

/**
 * 셀의 텍스트 추출 (라벨 매칭용)
 */
function getCellText(tc: any): string {
  const texts: string[] = [];
  const stack = [tc];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;

    if (node.tagName === 'w:t') {
      texts.push(node.textContent || '');
    }

    if (node.childNodes) {
      for (let i = node.childNodes.length - 1; i >= 0; i--) {
        const child = node.childNodes[i];
        if (child.nodeType === 1) {
          stack.push(child);
        }
      }
    }
  }

  return texts.join('').trim();
}

/**
 * 라벨로 셀 찾기 (모든 테이블에서 검색)
 */
function findCellByLabel(
  tables: any[],
  anchorLabel: string
): { tableIndex: number; rowIndex: number; cellResult: { tc: any; physicalIndex: number } } | null {
  const normalizedLabel = anchorLabel.replace(/\s+/g, '');

  for (let tIdx = 0; tIdx < tables.length; tIdx++) {
    const table = tables[tIdx];
    const rows = directChildrenByTag(table, 'w:tr');

    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      const row = rows[rIdx];
      const cells = directChildrenByTag(row, 'w:tc');

      for (let cIdx = 0; cIdx < cells.length; cIdx++) {
        const tc = cells[cIdx];
        const cellText = getCellText(tc);
        const normalizedCellText = cellText.replace(/\s+/g, '');

        if (normalizedCellText.includes(normalizedLabel)) {
          if (cIdx + 1 < cells.length) {
            return {
              tableIndex: tIdx,
              rowIndex: rIdx,
              cellResult: { tc: cells[cIdx + 1], physicalIndex: cIdx + 1 },
            };
          }
        }
      }
    }
  }

  return null;
}

/**
 * 논리적 열 인덱스에 해당하는 w:tc 찾기 (gridSpan 고려)
 */
function findCellAtLogicalIndex(tr: any, logicalCol: number): { tc: any; physicalIndex: number } | null {
  const cells = directChildrenByTag(tr, 'w:tc');
  let currentLogicalCol = 0;

  for (let i = 0; i < cells.length; i++) {
    const tc = cells[i];
    const span = getGridSpan(tc);

    if (logicalCol >= currentLogicalCol && logicalCol < currentLogicalCol + span) {
      return { tc, physicalIndex: i };
    }

    currentLogicalCol += span;
  }

  return null;
}

/**
 * 최상위 테이블 수집 (document order 유지)
 */
function getTopLevelTables(dom: any): any[] {
  const body = dom.getElementsByTagName('w:body')[0];
  if (!body) return [];

  const out: any[] = [];
  const kids = body.childNodes || [];
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType !== 1) continue;

    if (n.tagName === 'w:tbl') {
      out.push(n);
    } else if (n.tagName === 'w:sdt') {
      const sdtContent = getFirstDirectChild(n, 'w:sdtContent');
      if (sdtContent) {
        const sdtKids = sdtContent.childNodes || [];
        for (let j = 0; j < sdtKids.length; j++) {
          const m = sdtKids[j];
          if (m.nodeType === 1 && m.tagName === 'w:tbl') {
            out.push(m);
          }
        }
      }
    }
  }
  return out;
}

/**
 * w:tc 셀에서 w:tcPr만 남기고 나머지 제거
 */
function clearExceptTcPr(tc: any): any | null {
  const tcPr = getFirstDirectChild(tc, 'w:tcPr');
  const toRemove: any[] = [];

  for (let i = 0; i < tc.childNodes.length; i++) {
    const n = tc.childNodes[i];
    if (n === tcPr) continue;
    toRemove.push(n);
  }

  for (const n of toRemove) {
    tc.removeChild(n);
  }

  return tcPr;
}

/**
 * 셀에 텍스트 설정
 */
function setCellText(dom: any, tc: any, value: string): void {
  cleanupCell(tc);

  const firstP = getFirstDirectChild(tc, 'w:p');
  let pPrClone: any = null;
  let rPrClone: any = null;

  if (firstP) {
    const pPr = getFirstDirectChild(firstP, 'w:pPr');
    if (pPr) pPrClone = pPr.cloneNode(true);

    const firstR = getFirstDirectChild(firstP, 'w:r');
    if (firstR) {
      const rPr = getFirstDirectChild(firstR, 'w:rPr');
      if (rPr) rPrClone = rPr.cloneNode(true);
    }
  }

  const tcPr = clearExceptTcPr(tc);

  const p = dom.createElement('w:p');
  if (pPrClone) p.appendChild(pPrClone);

  const r = dom.createElement('w:r');
  if (rPrClone) r.appendChild(rPrClone);

  const lines = value.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const t = dom.createElement('w:t');
    t.setAttribute('xml:space', 'preserve');
    t.appendChild(dom.createTextNode(line));
    r.appendChild(t);

    if (i < lines.length - 1) {
      const br = dom.createElement('w:br');
      r.appendChild(br);
    }
  }

  p.appendChild(r);

  if (tcPr) {
    if (tcPr.nextSibling) {
      tc.insertBefore(p, tcPr.nextSibling);
    } else {
      tc.appendChild(p);
    }
  } else {
    tc.appendChild(p);
  }
}

/**
 * 모든 w:txbxContent 노드 가져오기
 */
function getAllTextboxes(dom: any): any[] {
  const out: any[] = [];
  const stack = [dom.documentElement];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;

    const tagName = node.tagName || '';
    const localName = tagName.indexOf(':') >= 0 ? tagName.slice(tagName.indexOf(':') + 1) : tagName;
    if (localName === 'txbxContent') {
      out.push(node);
    }

    if (node.childNodes) {
      for (let i = node.childNodes.length - 1; i >= 0; i--) {
        const child = node.childNodes[i];
        if (child.nodeType === 1) {
          stack.push(child);
        }
      }
    }
  }

  return out;
}

/**
 * 텍스트박스에 텍스트 설정
 */
function setTextboxText(dom: any, txbxContent: any, value: string): void {
  cleanupTextbox(txbxContent);

  const firstP = getFirstDirectChild(txbxContent, 'w:p');
  let pPrClone: any = null;
  let rPrClone: any = null;

  if (firstP) {
    const pPr = getFirstDirectChild(firstP, 'w:pPr');
    if (pPr) pPrClone = pPr.cloneNode(true);

    const firstR = getFirstDirectChild(firstP, 'w:r');
    if (firstR) {
      const rPr = getFirstDirectChild(firstR, 'w:rPr');
      if (rPr) rPrClone = rPr.cloneNode(true);
    }
  }

  const paras = directChildrenByTag(txbxContent, 'w:p');
  for (const p of paras) {
    txbxContent.removeChild(p);
  }

  const p = dom.createElement('w:p');
  if (pPrClone) p.appendChild(pPrClone);

  const r = dom.createElement('w:r');
  if (rPrClone) r.appendChild(rPrClone);

  const lines = value.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const t = dom.createElement('w:t');
    t.setAttribute('xml:space', 'preserve');
    t.appendChild(dom.createTextNode(line));
    r.appendChild(t);

    if (i < lines.length - 1) {
      const br = dom.createElement('w:br');
      r.appendChild(br);
    }
  }

  p.appendChild(r);
  txbxContent.appendChild(p);
}

/**
 * tagName에서 localName 추출 (namespace prefix 제거)
 */
function getLocalName(node: any): string {
  const name = node?.tagName || node?.nodeName || '';
  const idx = name.indexOf(':');
  return idx >= 0 ? name.slice(idx + 1) : name;
}

/**
 * 노드가 txbxContent 자손을 포함하는지 확인
 */
function containsTextbox(node: any): boolean {
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (!n) continue;
    if (getLocalName(n) === 'txbxContent') return true;
    if (n.childNodes) {
      for (let i = 0; i < n.childNodes.length; i++) {
        if (n.childNodes[i].nodeType === 1) stack.push(n.childNodes[i]);
      }
    }
  }
  return false;
}

/**
 * 문단의 numPr 확인
 */
function hasNumPr(p: any): boolean {
  if (!p.childNodes) return false;
  for (let i = 0; i < p.childNodes.length; i++) {
    const child = p.childNodes[i];
    if (child.nodeType === 1 && getLocalName(child) === 'pPr') {
      for (let j = 0; j < child.childNodes.length; j++) {
        if (child.childNodes[j].nodeType === 1 && getLocalName(child.childNodes[j]) === 'numPr') {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Body 섹션 채우기: 섹션 타이틀 시그니처로 위치를 찾고, ㅇ/- 문단을 AI 내용으로 교체
 */
function fillBodySection(dom: any, titleSignature: string, value: string): boolean {
  const body = dom.getElementsByTagName('w:body')[0];
  if (!body) return false;

  const kids = body.childNodes || [];

  // 1단계: 섹션 타이틀 텍스트박스를 포함하는 body child 찾기
  let titleIndex = -1;
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType !== 1) continue;
    if (!containsTextbox(n)) continue;

    const text = getCellText(n).trim();
    const fullSig = text.substring(0, 60).replace(/[^가-힣a-zA-Z0-9]/g, '').substring(0, 30);
    const halfText = text.substring(0, Math.floor(text.length / 2));
    const halfSig = halfText.substring(0, 60).replace(/[^가-힣a-zA-Z0-9]/g, '').substring(0, 30);

    if (fullSig === titleSignature || halfSig === titleSignature) {
      titleIndex = i;
      break;
    }
  }

  if (titleIndex === -1) {
    console.log(`[fillDocx] body_section: 타이틀 시그니처 "${titleSignature}" 찾지 못함`);
    return false;
  }

  // 2단계: 타이틀 이후의 ㅇ/EMPTY/BULLET 문단 범위 찾기
  let contentStart = -1;
  let contentEnd = -1;
  const toRemove: any[] = [];

  for (let i = titleIndex + 1; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType !== 1) continue;

    const tag = getLocalName(n);
    const text = getCellText(n).trim();
    const hasTxbx = containsTextbox(n);

    if (hasTxbx) {
      if (text.includes('※')) continue;
      break;
    }

    if (tag === 'tbl') break;

    if (tag === 'p') {
      const isCircle = text === 'ㅇ' || text === '○';
      const isEmpty = !text || text.length === 0;
      const isBullet = hasNumPr(n);
      const isGuideText = text.startsWith('※');

      if (isCircle || isEmpty || isBullet || isGuideText) {
        if (contentStart === -1) contentStart = i;
        contentEnd = i;
        toRemove.push(n);
      } else {
        break;
      }
    }
  }

  if (toRemove.length === 0) {
    console.log(`[fillDocx] body_section: 교체할 ㅇ/- 문단 없음 (타이틀 "${titleSignature}")`);
    return false;
  }

  console.log(`[fillDocx] body_section: body[${contentStart}..${contentEnd}] ${toRemove.length}개 문단 교체`);

  // 3단계: 기존 ㅇ/- 문단에서 pPr 스타일 복제
  let basePPrClone: any = null;
  for (const node of toRemove) {
    const pPr = getFirstDirectChild(node, 'w:pPr');
    if (pPr) {
      basePPrClone = pPr.cloneNode(true);
      const numPr = getFirstDirectChild(basePPrClone, 'w:numPr');
      if (numPr) basePPrClone.removeChild(numPr);
      break;
    }
  }

  // 4단계: 삽입 위치 기준점
  const insertBefore = toRemove[toRemove.length - 1].nextSibling;

  // 5단계: 기존 문단 제거
  for (const node of toRemove) {
    body.removeChild(node);
  }

  // 6단계: 새 문단 생성 및 삽입
  const lines = value.split(/\r?\n/).filter(line => line.trim().length > 0);

  for (const line of lines) {
    const p = dom.createElement('w:p');

    if (basePPrClone) {
      p.appendChild(basePPrClone.cloneNode(true));
    }

    const r = dom.createElement('w:r');
    const t = dom.createElement('w:t');
    t.setAttribute('xml:space', 'preserve');
    t.appendChild(dom.createTextNode(line));
    r.appendChild(t);
    p.appendChild(r);

    if (insertBefore) {
      body.insertBefore(p, insertBefore);
    } else {
      body.appendChild(p);
    }
  }

  return true;
}

/**
 * 메인 함수: DOCX 템플릿에 ops 적용
 */
export async function fillDocx(
  templateBuffer: Buffer,
  ops: WriteOp[],
  options: FillDocxOptions = {}
): Promise<FillDocxResult> {
  const { skipEmpty = false } = options;

  const zip = await JSZip.loadAsync(templateBuffer);
  const docXmlPath = 'word/document.xml';
  const docXmlFile = zip.file(docXmlPath);

  if (!docXmlFile) {
    throw new Error('word/document.xml not found in DOCX');
  }

  const docXml = await docXmlFile.async('string');
  const dom = new DOMParser().parseFromString(docXml, 'text/xml');

  const tables = getTopLevelTables(dom);
  const textboxes = getAllTextboxes(dom);

  // body 직계 자식 구조 덤프 (진단용)
  const body = dom.getElementsByTagName('w:body')[0];
  if (body) {
    const bodyStructure: string[] = [];
    const kids = body.childNodes || [];
    for (let i = 0; i < kids.length; i++) {
      const n = kids[i] as any;
      if (n.nodeType === 1) bodyStructure.push(n.tagName);
    }
    console.log(`[fillDocx] body 직계 자식 (${bodyStructure.length}개):`, bodyStructure.join(', '));
    console.log(`[fillDocx] topTables 발굴 수: ${tables.length}`);
    console.log(`[fillDocx] textboxes 발굴 수: ${textboxes.length}`);
  }

  const summary: FillSummary = {
    ok: 0,
    fail: 0,
    badPath: 0,
    noTable: 0,
    noRow: 0,
    noCell: 0,
    topTables: tables.length,
  };

  for (const op of ops) {
    const value = op.value;

    if (skipEmpty) {
      if (value == null || String(value).trim() === '') {
        continue;
      }
    }

    const slotType = op.slotType || 'long_text';

    if (slotType === 'table_budget' || slotType === 'table_schedule') {
      console.log(`[fillDocx] SKIP ${slotType}: xmlPath="${op.xmlPath}" (구조화 표는 현재 미지원)`);
      continue;
    }

    if (slotType === 'delete_only') {
      console.log(`[fillDocx] SKIP delete_only: xmlPath="${op.xmlPath}" (삭제 전용)`);
      continue;
    }

    if (slotType === 'image') {
      console.log(`[fillDocx] SKIP image: xmlPath="${op.xmlPath}" (이미지는 현재 미지원)`);
      continue;
    }

    const pos = parseXmlPath(op.xmlPath);
    if (!pos) {
      console.log(`[fillDocx] FAIL badPath: xmlPath="${op.xmlPath}"`);
      summary.badPath++;
      summary.fail++;
      continue;
    }

    // 텍스트박스 경로 처리 (인덱스 기반 - 레거시)
    if ('textboxId' in pos) {
      const txbxIndex = pos.textboxId;
      const txbx = textboxes[txbxIndex];

      if (!txbx) {
        console.log(`[fillDocx] FAIL noTextbox: xmlPath="${op.xmlPath}" txbxIndex=${txbxIndex} (textboxes=${textboxes.length})`);
        summary.fail++;
        continue;
      }

      setTextboxText(dom, txbx, String(value ?? ''));
      console.log(`[fillDocx] OK (textbox-idx): xmlPath="${op.xmlPath}"`);
      summary.ok++;
      continue;
    }

    // 텍스트박스 경로 처리 (텍스트 내용 매칭)
    if ('textboxContentMatch' in pos) {
      const signature = pos.textboxContentMatch;
      let matchCount = 0;

      for (let ti = 0; ti < textboxes.length; ti++) {
        const txbx = textboxes[ti];
        const txbxText = getCellText(txbx).trim();
        const txbxSig = txbxText.substring(0, 60).replace(/[^가-힣a-zA-Z0-9]/g, '').substring(0, 30);

        if (txbxSig === signature) {
          setTextboxText(dom, txbx, String(value ?? ''));
          matchCount++;
        }
      }

      if (matchCount > 0) {
        console.log(`[fillDocx] OK (textbox-match): xmlPath="${op.xmlPath}" sig="${signature}" (${matchCount}개 매칭)`);
        summary.ok++;
      } else {
        console.log(`[fillDocx] FAIL noTextboxMatch: xmlPath="${op.xmlPath}" sig="${signature}" (textboxes=${textboxes.length})`);
        summary.fail++;
      }
      continue;
    }

    // Body 섹션 경로 처리
    if ('bodySectionTitle' in pos) {
      const titleSig = pos.bodySectionTitle;
      const filled = fillBodySection(dom, titleSig, String(value ?? ''));
      if (filled) {
        console.log(`[fillDocx] OK (body-section): xmlPath="${op.xmlPath}"`);
        summary.ok++;
      } else {
        console.log(`[fillDocx] FAIL body-section: xmlPath="${op.xmlPath}" sig="${titleSig}"`);
        summary.fail++;
      }
      continue;
    }

    // 테이블 경로 처리
    if ('tableId' in pos) {
      let tIndex = pos.tableId - 1;
      let rIndex = pos.row;
      let cIndex = pos.col;
      let tc: any = null;
      let usedFallback = false;

      const tbl = tables[tIndex];
      if (tbl) {
        const rows = directChildrenByTag(tbl, 'w:tr');
        const tr = rows[rIndex];
        if (tr) {
          const cellResult = findCellAtLogicalIndex(tr, cIndex);
          if (cellResult) {
            tc = cellResult.tc;
          }
        }
      }

      if (!tc && op.anchorLabel) {
        console.log(`[fillDocx] 1차 실패, anchorLabel="${op.anchorLabel}"로 재탐색 시도...`);
        const found = findCellByLabel(tables, op.anchorLabel);
        if (found) {
          tIndex = found.tableIndex;
          rIndex = found.rowIndex;
          tc = found.cellResult.tc;
          usedFallback = true;
          console.log(`[fillDocx] ✓ 라벨 기반 재탐색 성공: table${tIndex + 1}:r${rIndex}:c${found.cellResult.physicalIndex}`);
        } else {
          console.log(`[fillDocx] ✗ 라벨 기반 재탐색 실패: "${op.anchorLabel}" 찾을 수 없음`);
        }
      }

      if (!tc) {
        if (!tbl) {
          console.log(`[fillDocx] FAIL noTable: xmlPath="${op.xmlPath}" tIndex=${tIndex} (topTables=${tables.length})`);
          summary.noTable++;
        } else {
          const rows = directChildrenByTag(tbl, 'w:tr');
          const tr = rows[rIndex];
          if (!tr) {
            console.log(`[fillDocx] FAIL noRow: xmlPath="${op.xmlPath}" rIndex=${rIndex} (rows=${rows.length})`);
            summary.noRow++;
          } else {
            const cells = directChildrenByTag(tr, 'w:tc');
            const spans = cells.map((c: any) => getGridSpan(c));
            const logicalCellCount = spans.reduce((sum: number, span: number) => sum + span, 0);
            console.log(`[fillDocx] FAIL noCell: xmlPath="${op.xmlPath}" logicalCol=${cIndex} (physical cells=${cells.length}, gridSpans=[${spans.join(',')}], logical cells=${logicalCellCount})`);
            summary.noCell++;
          }
        }
        summary.fail++;
        continue;
      }

      setCellText(dom, tc, String(value ?? ''));
      const fallbackMsg = usedFallback ? ' (via label fallback)' : '';
      console.log(`[fillDocx] OK (table): xmlPath="${op.xmlPath}"${fallbackMsg}`);
      summary.ok++;
    }
  }

  const outXml = new XMLSerializer().serializeToString(dom);
  zip.file(docXmlPath, outXml);

  const outBuffer = await zip.generateAsync({ type: 'nodebuffer' });

  return {
    buffer: outBuffer,
    summary,
  };
}
