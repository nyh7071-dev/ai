/**
 * lib/docx/sdtScanner.ts
 *
 * 모든 DOCX 파트에서 w:sdt (Content Control) 스캔
 * - document.xml, header*.xml, footer*.xml, footnotes.xml, endnotes.xml
 * - w:tag > w:alias > fallback 키 추출
 * - 정확한 xmlPath 계산 (table{t}:r{r}:c{c} 또는 para{n})
 * - label 추론
 */

import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';

export type SlotType = 'short_text' | 'long_text' | 'table_budget' | 'table_schedule' | 'image' | 'delete_only';

export interface SDTSlot {
  key: string;
  label: string;
  kind: 'sdt';
  part: string; // e.g., "word/document.xml"
  xmlPath: string; // e.g., "document:table4:r0:c1"
  confidence: number;
  slotType?: SlotType;
  anchorLabel?: string;
}

export interface SDTScanResult {
  slots: SDTSlot[];
  partsScanned: string[];
}

/**
 * DOCX의 모든 파트를 스캔하여 SDT 추출
 */
export async function scanAllSDTs(buffer: Buffer): Promise<SDTScanResult> {
  const zip = await JSZip.loadAsync(buffer);
  const slots: SDTSlot[] = [];
  const partsScanned: string[] = [];
  const seenKeys = new Set<string>();

  // 스캔할 파트 목록
  const partsToScan = [
    'word/document.xml',
    'word/header1.xml',
    'word/header2.xml',
    'word/header3.xml',
    'word/footer1.xml',
    'word/footer2.xml',
    'word/footer3.xml',
    'word/footnotes.xml',
    'word/endnotes.xml',
  ];

  for (const partPath of partsToScan) {
    const partFile = zip.file(partPath);
    if (!partFile) continue; // 파일이 없으면 스킵

    console.log(`[SDT Scanner] 스캔 중: ${partPath}`);
    partsScanned.push(partPath);

    const partXml = await partFile.async('text');
    const dom = new DOMParser().parseFromString(partXml, 'text/xml');

    // 파트 내 모든 SDT 탐색
    const sdts = dom.getElementsByTagName('w:sdt');
    console.log(`[SDT Scanner]   - ${sdts.length}개 SDT 발견`);

    for (let i = 0; i < sdts.length; i++) {
      const sdt = sdts[i];

      // 1. Key 추출 (w:tag > w:alias > fallback)
      const key = extractSDTKey(sdt, partPath, i);

      // 중복 체크
      if (seenKeys.has(key)) {
        console.log(`[SDT Scanner]   - 중복 키 스킵: ${key}`);
        continue;
      }
      seenKeys.add(key);

      // 2. xmlPath 계산
      const xmlPath = calculateXmlPath(sdt, dom, partPath);

      // 3. label 추론
      const label = inferLabel(sdt, dom) || key;

      slots.push({
        key,
        label,
        kind: 'sdt',
        part: partPath,
        xmlPath,
        confidence: 1.0, // SDT는 높은 신뢰도
      });

      console.log(`[SDT Scanner]   ✓ ${key} (${xmlPath})`);
    }
  }

  console.log(`[SDT Scanner] 완료: ${slots.length}개 SDT 슬롯, ${partsScanned.length}개 파트 스캔`);
  return { slots, partsScanned };
}

/**
 * SDT에서 key 추출
 * 우선순위: w:tag > w:alias > fallback
 */
function extractSDTKey(sdt: any, partPath: string, index: number): string {
  // 1순위: w:tag/@w:val
  const sdtPr = sdt.getElementsByTagName('w:sdtPr')[0];
  if (sdtPr) {
    const tags = sdtPr.getElementsByTagName('w:tag');
    if (tags.length > 0) {
      const tagVal = tags[0].getAttribute('w:val');
      if (tagVal && tagVal.trim()) {
        return tagVal.trim();
      }
    }

    // 2순위: w:alias/@w:val
    const aliases = sdtPr.getElementsByTagName('w:alias');
    if (aliases.length > 0) {
      const aliasVal = aliases[0].getAttribute('w:val');
      if (aliasVal && aliasVal.trim()) {
        return aliasVal.trim();
      }
    }
  }

  // 3순위: fallback (part 기반)
  const partName = partPath.replace('word/', '').replace('.xml', '');
  return `SDT_${partName}_${index}`;
}

/**
 * SDT의 xmlPath 계산
 * - 표 내부: document:table{t}:r{r}:c{c}
 * - 표 외부: document:para{n}
 */
function calculateXmlPath(sdt: any, dom: any, partPath: string): string {
  const partName = partPath.replace('word/', '').replace('.xml', '');

  // SDT가 표 셀(w:tc) 내부에 있는지 확인
  const tc = findAncestor(sdt, 'w:tc');
  if (tc) {
    // 표 내부
    const tr = findAncestor(tc, 'w:tr');
    const tbl = findAncestor(tr, 'w:tbl');

    if (!tbl || !tr) {
      return `${partName}:table?:r?:c?`;
    }

    // 테이블 인덱스 계산 (1-based)
    const tableIndex = getTableIndex(tbl, dom) + 1;

    // 행 인덱스 계산 (0-based)
    const rowIndex = getChildIndex(tr, tbl, 'w:tr');

    // 셀 인덱스 계산 (0-based, 병합 셀 무시)
    const cellIndex = getChildIndex(tc, tr, 'w:tc');

    return `${partName}:table${tableIndex}:r${rowIndex}:c${cellIndex}`;
  }

  // 표 외부 - 문단 내부인지 확인
  const para = findAncestor(sdt, 'w:p');
  if (para) {
    const body = dom.getElementsByTagName('w:body')[0];
    if (body) {
      const paraIndex = getChildIndex(para, body, 'w:p');
      return `${partName}:para${paraIndex}`;
    }
  }

  return `${partName}:unknown`;
}

/**
 * 특정 태그의 조상 노드 찾기
 */
function findAncestor(node: any, tagName: string): any {
  let current = node.parentNode;
  while (current) {
    if (current.tagName === tagName) {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

/**
 * 부모 노드에서 자식의 인덱스 계산 (특정 태그만)
 */
function getChildIndex(child: any, parent: any, tagName: string): number {
  let index = 0;
  for (let i = 0; i < parent.childNodes.length; i++) {
    const node = parent.childNodes[i];
    if (node === child) {
      return index;
    }
    if (node.tagName === tagName) {
      index++;
    }
  }
  return -1;
}

/**
 * 문서 내에서 테이블의 인덱스 계산 (0-based)
 */
function getTableIndex(tbl: any, dom: any): number {
  const body = dom.getElementsByTagName('w:body')[0];
  if (!body) return -1;

  let tableCount = 0;
  for (let i = 0; i < body.childNodes.length; i++) {
    const node = body.childNodes[i];
    if (node.tagName === 'w:tbl') {
      if (node === tbl) {
        return tableCount;
      }
      tableCount++;
    }
  }
  return -1;
}

/**
 * SDT의 label 추론
 * - 같은 행에서 왼쪽 셀의 텍스트
 * - 또는 바로 앞 문단 텍스트
 */
function inferLabel(sdt: any, dom: any): string | null {
  // 표 셀 내부라면 같은 행의 왼쪽 셀 텍스트 확인
  const tc = findAncestor(sdt, 'w:tc');
  if (tc) {
    const tr = findAncestor(tc, 'w:tr');
    if (tr) {
      const cells = [];
      for (let i = 0; i < tr.childNodes.length; i++) {
        const node = tr.childNodes[i];
        if (node.tagName === 'w:tc') {
          cells.push(node);
        }
      }

      const cellIndex = cells.indexOf(tc);
      if (cellIndex > 0) {
        // 왼쪽 셀의 텍스트 추출
        const leftCell = cells[cellIndex - 1];
        const text = getCellText(leftCell).trim();
        if (text) return text;
      }
    }
  }

  // 표 외부라면 바로 앞 문단 텍스트 확인
  const para = findAncestor(sdt, 'w:p');
  if (para && para.previousSibling) {
    const prevNode = para.previousSibling;
    if (prevNode.tagName === 'w:p') {
      const text = getParaText(prevNode).trim();
      if (text) return text;
    }
  }

  return null;
}

/**
 * 셀의 텍스트 추출
 */
function getCellText(tc: any): string {
  const texts: string[] = [];
  const tNodes = tc.getElementsByTagName('w:t');
  for (let i = 0; i < tNodes.length; i++) {
    texts.push(tNodes[i].textContent || '');
  }
  return texts.join('');
}

/**
 * 문단의 텍스트 추출
 */
function getParaText(para: any): string {
  const texts: string[] = [];
  const tNodes = para.getElementsByTagName('w:t');
  for (let i = 0; i < tNodes.length; i++) {
    texts.push(tNodes[i].textContent || '');
  }
  return texts.join('');
}
