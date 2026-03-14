/**
 * universalSlotScanner.ts – DOCX 유니버설 슬롯 스캐너
 *
 * DOCX XML에서 채울 수 있는 슬롯(BODY_SECTION, TEXTBOX, TABLE)을 감지.
 * BODY_SECTION 슬롯이 목록 앞쪽에 배치되도록 우선 스캔.
 */

import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import {
  getFirstDirectChild,
  directChildrenByTag,
} from "./cleanup";

/* ─── types ─── */

export type SlotKind = "BODY_SECTION" | "TEXTBOX" | "TABLE_CELL";

export interface Slot {
  key: string;
  kind: SlotKind;
  label: string;
  currentText: string;
  xmlPath: string;
  structural?: boolean;
}

/* ─── signature helper ─── */

function makeSignature(text: string): string {
  return text
    .substring(0, 60)
    .replace(/[^가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9]/g, "")
    .substring(0, 30);
}

/* ─── text extraction ─── */

function extractText(el: Element): string {
  const texts: string[] = [];
  const runs = el.getElementsByTagName("w:r");
  for (let i = 0; i < runs.length; i++) {
    const tEls = runs[i].getElementsByTagName("w:t");
    for (let j = 0; j < tEls.length; j++) {
      texts.push(tEls[j].textContent || "");
    }
  }
  return texts.join("").trim();
}

function extractDirectText(p: Element): string {
  const texts: string[] = [];
  const runs = directChildrenByTag(p, "r");
  for (const r of runs) {
    const tEl = getFirstDirectChild(r, "t");
    if (tEl) texts.push(tEl.textContent || "");
  }
  return texts.join("").trim();
}

/* ─── body direct children (SDT 언래핑 포함) ─── */

/** w:body 직접 자식에서 w:sdt 안의 콘텐츠를 언래핑하여 평탄화 */
function flattenBodyChildren(body: Element): Element[] {
  const result: Element[] = [];
  for (let i = 0; i < body.childNodes.length; i++) {
    const n = body.childNodes[i];
    if (n.nodeType !== 1) continue;
    const el = n as Element;
    if (el.localName === "sdt") {
      // w:sdt → w:sdtContent 안의 자식을 꺼냄
      const sdtContent = getFirstDirectChild(el, "sdtContent");
      if (sdtContent) {
        for (let j = 0; j < sdtContent.childNodes.length; j++) {
          const inner = sdtContent.childNodes[j];
          if (inner.nodeType === 1) result.push(inner as Element);
        }
      }
    } else {
      result.push(el);
    }
  }
  return result;
}

/* ─── BODY_SECTION scanner ─── */

function isBodySectionTitle(p: Element): boolean {
  const text = extractDirectText(p);
  if (!text) return false;

  // ㅇ/○ 마커
  if (/^[ㅇ○]/.test(text)) return true;
  // 숫자 제목: 1. 2) 등
  if (/^\d+[\.\)]/.test(text)) return true;
  // 괄호 숫자: (1) (2) 등
  if (/^\(\d+\)/.test(text)) return true;
  // 가. 나. 다. 한글 번호
  if (/^[가-힣][\.\)]/.test(text) && text.length > 2) return true;
  // ※ 참고/유의
  if (/^※/.test(text)) return true;
  // □/■/▶ 마커
  if (/^[□■▶▷●◆]/.test(text)) return true;
  // I. II. III. 로마 숫자 (ASCII)
  if (/^[IVX]+[\.\)]/.test(text)) return true;
  // Ⅰ Ⅱ Ⅲ Ⅳ Ⅴ 로마 숫자 (유니코드 전각)
  if (/^[\u2160-\u216F\u2170-\u217F]/.test(text)) return true;
  // 제1장, 제2절 등
  if (/^제\d+[장절항]/.test(text)) return true;
  // 【】 괄호
  if (/^【/.test(text)) return true;
  // [...] 대괄호 섹션: [국내외 제약사], [임상연구] 등
  if (/^\[.+\]/.test(text)) return true;
  // "라벨 : 내용" 콜론 패턴: "관련 뉴스 : ...", "주요내용 : ...", "의의 : ..." 등
  // 콜론 앞 라벨이 한글/영문 1~15자이고 뒤에 내용이 있는 경우
  if (/^[가-힣a-zA-Z\s]{1,15}\s*:\s*.+/.test(text)) return true;

  // w:numPr (bullet/numbering)
  const pPr = getFirstDirectChild(p, "pPr");
  if (pPr) {
    if (getFirstDirectChild(pPr, "numPr")) return true;

    // heading 스타일 감지
    const pStyle = getFirstDirectChild(pPr, "pStyle");
    if (pStyle) {
      const val = (pStyle.getAttribute("w:val") || "").toLowerCase();
      // "Heading1", "heading2", "제목", "Title", "TOC" 등
      if (/heading|제목|title|toc/.test(val)) return true;
      // Word 숫자 전용 스타일 ("1", "2", "3" = 제목1, 제목2, 제목3)
      if (/^\d+$/.test(val)) return true;
    }

    // outlineLvl (개요 수준) 감지
    if (getFirstDirectChild(pPr, "outlineLvl")) return true;
  }

  return false;
}

export function scanBodySections(dom: Document): Slot[] {
  const slots: Slot[] = [];
  const body = dom.getElementsByTagName("w:body")[0];
  if (!body) return slots;

  // SDT 언래핑 포함한 평탄화
  const children = flattenBodyChildren(body);

  let sIdx = 0;

  for (let i = 0; i < children.length; i++) {
    const el = children[i];
    if (el.localName !== "p") continue;
    if (!isBodySectionTitle(el)) continue;

    const titleText = extractDirectText(el);
    const sig = makeSignature(titleText);
    if (!sig) continue;

    // 이 제목 이후의 본문 단락 수집
    const contentParagraphs: string[] = [];
    for (let j = i + 1; j < children.length; j++) {
      const next = children[j];
      if (next.localName === "p") {
        if (isBodySectionTitle(next)) break;
        const t = extractDirectText(next);
        if (t) contentParagraphs.push(t);
      } else if (next.localName === "tbl") {
        break;
      }
    }

    slots.push({
      key: `BODY_SECTION_${sIdx}`,
      kind: "BODY_SECTION",
      label: titleText.substring(0, 80),
      currentText: contentParagraphs.join("\n").substring(0, 500),
      xmlPath: `document:body_section:${sig}`,
    });
    sIdx++;
  }

  return slots;
}

/* ─── structural textbox detection ─── */

/** 구조적 텍스트박스 (문서 제목, 열 헤더, 섹션 헤더) 필터링 */
function isStructuralTextbox(text: string): boolean {
  const t = text.trim();

  // 문서 제목 / 목차 / 사업계획서 타이틀
  if (/목차/.test(t)) return true;
  if (/사업계획서/.test(t) && t.length < 40) return true;

  // 열 헤더: " / "로 구분된 3개 이상 항목
  if (t.split(/\s*\/\s*/).length >= 3) return true;

  // 섹션 헤더: "~현황 (설명)" 패턴
  if (/현황\s*[((]/.test(t) && t.length < 40) return true;

  return false;
}

/** 열 헤더 텍스트박스 감지: 모든 비어있지 않은 단락이 ≤10자이고 3개 이상 */
function isColumnHeaderTextbox(txbx: Element): boolean {
  const paragraphs = directChildrenByTag(txbx, "p");
  if (paragraphs.length < 3) return false;

  let shortCount = 0;
  for (const p of paragraphs) {
    const text = extractDirectText(p).trim();
    if (!text) continue;
    // 10자 초과 단락이 하나라도 있으면 열 헤더가 아님
    if (text.length > 10) return false;
    shortCount++;
  }
  return shortCount >= 3;
}

/* ─── TEXTBOX scanner ─── */

export function scanTextboxes(dom: Document): Slot[] {
  const slots: Slot[] = [];

  // w:txbxContent elements
  const txbxContents = dom.getElementsByTagName("w:txbxContent");
  const seen = new Set<string>();

  for (let i = 0; i < txbxContents.length; i++) {
    const txbx = txbxContents[i] as Element;

    // 텍스트박스 안에 테이블이 있으면 스킵 (TABLE_CELL 슬롯으로 별도 스캔됨)
    if (txbx.getElementsByTagName("w:tbl").length > 0) continue;

    const text = extractText(txbx);
    if (!text) continue;

    // 구조적 텍스트박스 판별 (제목, 열 헤더, 섹션 헤더)
    const isStructural = isStructuralTextbox(text) || isColumnHeaderTextbox(txbx);

    const sig = makeSignature(text);
    // mc:AlternateContent causes duplicates – use halfSig (20 chars) dedup
    const halfSig = sig.substring(0, 20);
    if (seen.has(halfSig)) continue;
    seen.add(halfSig);

    slots.push({
      key: `TEXTBOX_${i}`,
      kind: "TEXTBOX",
      label: text.substring(0, 80),
      currentText: text.substring(0, 500),
      xmlPath: `document:textbox:${sig}`,
      ...(isStructural ? { structural: true } : {}),
    });
  }

  return slots;
}

/* ─── TABLE scanner ─── */

/** 문서 내 모든 테이블 반환 (중첩 테이블, 텍스트박스 내부 테이블 포함) */
export function getAllTables(dom: Document): Element[] {
  const tables: Element[] = [];
  const tblNodes = dom.getElementsByTagName("w:tbl");
  for (let i = 0; i < tblNodes.length; i++) {
    tables.push(tblNodes[i] as Element);
  }
  return tables;
}

/** 헤더 행 감지: 모든 셀의 텍스트가 짧은 라벨이고 데이터가 아닌 경우 */
function isHeaderRow(row: Element): boolean {
  const cells = directChildrenByTag(row, "tc");
  if (cells.length < 2) return false;

  let nonEmptyCount = 0;
  for (const cell of cells) {
    const text = extractText(cell).trim();
    if (!text) continue;
    nonEmptyCount++;
    // 15자 초과 셀이 있으면 헤더가 아님
    if (text.length > 15) return false;
    // 순수 숫자(학번, 금액 등) → 데이터 행이므로 헤더 아님
    if (/^\d+$/.test(text)) return false;
    // 숫자+단위 패턴 (100만원, 3개월 등) → 데이터
    if (/^\d+[만억천원개월%]/.test(text)) return false;
  }
  // 비어있지 않은 셀이 2개 이상이면 헤더 행으로 판정
  return nonEmptyCount >= 2;
}

/** 라벨 셀 감지: 짧은 섹션 이름으로만 구성된 셀 */
function isLabelCell(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 10) return false;
  // 순수 숫자 → 데이터 (학번, 금액 등)
  if (/^\d+$/.test(t)) return false;
  // 안내 표시 포함 → 데이터 또는 입력칸
  if (/[()]|입력|작성|기재|예시/.test(t)) return false;
  return true;
}

/** 헤더 행에서 컬럼명 배열 추출 */
function extractColumnHeaders(rows: Element[]): string[] {
  for (const row of rows) {
    if (!isHeaderRow(row)) continue;
    const cells = directChildrenByTag(row, "tc");
    return cells.map((cell) => extractText(cell).trim());
  }
  return [];
}

export function scanTable(tbl: Element, tblIdx: number): Slot[] {
  const slots: Slot[] = [];
  // directChildrenByTag로 직접 자식만 가져옴 (중첩 테이블 행 제외)
  const rows = directChildrenByTag(tbl, "tr");

  // 헤더 행에서 컬럼명 추출 (빈 셀 라벨에 사용)
  const columnHeaders = extractColumnHeaders(rows);

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const rowIsHeader = isHeaderRow(row);

    // directChildrenByTag로 직접 자식 셀만 (중첩 테이블 셀 제외)
    const cells = directChildrenByTag(row, "tc");

    // 첫 번째 셀이 라벨인지 확인 (빈 셀에 컨텍스트 제공용)
    let rowLabel = "";
    if (cells.length > 1) {
      const firstText = extractText(cells[0]).trim();
      if (isLabelCell(firstText)) {
        rowLabel = firstText;
      }
    }

    for (let c = 0; c < cells.length; c++) {
      const cell = cells[c];
      const text = extractText(cell);

      // 구조적 셀 판별: 헤더 행의 셀 또는 첫 번째 라벨 셀
      const cellIsStructural = rowIsHeader || (c === 0 && cells.length > 1 && isLabelCell(text));

      // 빈 셀 처리: 컬럼 헤더명 또는 rowLabel로 라벨 생성
      if (!text) {
        const colHeader = columnHeaders[c] || "";
        const label = colHeader
          ? `${colHeader} (${r + 1}행)`
          : rowLabel
            ? `${rowLabel} (${c + 1}열)`
            : `${r + 1}행 ${c + 1}열`;
        slots.push({
          key: `TABLE_${tblIdx}_R${r}_C${c}`,
          kind: "TABLE_CELL",
          label,
          currentText: "",
          xmlPath: `document:table[${tblIdx}]:row[${r}]:cell[${c}]`,
        });
        continue;
      }

      slots.push({
        key: `TABLE_${tblIdx}_R${r}_C${c}`,
        kind: "TABLE_CELL",
        label: text.substring(0, 80),
        currentText: text.substring(0, 500),
        xmlPath: `document:table[${tblIdx}]:row[${r}]:cell[${c}]`,
        ...(cellIsStructural ? { structural: true } : {}),
      });
    }
  }

  return slots;
}

/* ─── diagnostics ─── */

function diagnoseDocument(dom: Document): {
  totalParagraphs: number;
  totalTables: number;
  totalTextboxes: number;
  totalSdts: number;
  totalRuns: number;
  bodyDirectChildren: Record<string, number>;
  sampleParagraphs: Array<{ idx: number; text: string; hasNumPr: boolean; pStyle: string }>;
} {
  const totalParagraphs = dom.getElementsByTagName("w:p").length;
  const totalTables = dom.getElementsByTagName("w:tbl").length;
  const totalTextboxes = dom.getElementsByTagName("w:txbxContent").length;
  const totalSdts = dom.getElementsByTagName("w:sdt").length;
  const totalRuns = dom.getElementsByTagName("w:r").length;

  const bodyDirectChildren: Record<string, number> = {};
  const sampleParagraphs: Array<{ idx: number; text: string; hasNumPr: boolean; pStyle: string }> = [];
  const body = dom.getElementsByTagName("w:body")[0];
  if (body) {
    let pIdx = 0;
    for (let i = 0; i < body.childNodes.length; i++) {
      const n = body.childNodes[i];
      if (n.nodeType !== 1) continue;
      const el = n as Element;
      const tag = el.localName || "unknown";
      bodyDirectChildren[tag] = (bodyDirectChildren[tag] || 0) + 1;

      if (tag === "p") {
        const text = extractDirectText(el);
        const pPr = getFirstDirectChild(el, "pPr");
        const hasNumPr = pPr ? !!getFirstDirectChild(pPr, "numPr") : false;
        const pStyleEl = pPr ? getFirstDirectChild(pPr, "pStyle") : null;
        const pStyle = pStyleEl ? (pStyleEl.getAttribute("w:val") || "") : "";
        sampleParagraphs.push({ idx: pIdx, text: text.substring(0, 100), hasNumPr, pStyle });
        pIdx++;
      }
    }
  }

  return { totalParagraphs, totalTables, totalTextboxes, totalSdts, totalRuns, bodyDirectChildren, sampleParagraphs };
}

/* ─── main entry ─── */

export async function scanUniversalSlots(
  docxBuffer: ArrayBuffer
): Promise<{ slots: Slot[]; debug: { bodySections: number; textboxes: number; tables: number; diagnostics?: Record<string, unknown> } }> {
  const zip = await JSZip.loadAsync(docxBuffer);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) throw new Error("word/document.xml not found in DOCX");

  const dom = new DOMParser().parseFromString(documentXml, "text/xml");

  // 문서 구조 진단
  const diag = diagnoseDocument(dom);
  console.log(`[universalSlotScanner] 문서 진단:`, JSON.stringify(diag));

  // BODY_SECTION 슬롯을 먼저 스캔 (사용자 요청: 앞쪽 배치)
  const bodySections = scanBodySections(dom);
  const textboxes = scanTextboxes(dom);

  const tables = getAllTables(dom);
  const tableSlots: Slot[] = [];
  for (let t = 0; t < tables.length; t++) {
    tableSlots.push(...scanTable(tables[t], t));
  }

  console.log(
    `[universalSlotScanner] BODY_SECTION: ${bodySections.length}, TEXTBOX: ${textboxes.length}, TABLE: ${tableSlots.length}`
  );

  const slots = [...bodySections, ...textboxes, ...tableSlots];

  // 슬롯이 0개인데 문서에 콘텐츠가 있으면 경고 + 단락 샘플 출력
  if (slots.length === 0 && (diag.totalParagraphs > 0 || diag.totalTables > 0)) {
    console.warn(
      `[universalSlotScanner] ⚠️ 슬롯 0개 감지됨! 문서에 단락 ${diag.totalParagraphs}개, 테이블 ${diag.totalTables}개, SDT ${diag.totalSdts}개 존재.`,
      `body 직접자식:`, JSON.stringify(diag.bodyDirectChildren)
    );
    console.warn(`[universalSlotScanner] 단락 샘플:`, JSON.stringify(diag.sampleParagraphs, null, 2));
  }

  return {
    slots,
    debug: {
      bodySections: bodySections.length,
      textboxes: textboxes.length,
      tables: tableSlots.length,
      diagnostics: slots.length === 0 ? diag : undefined,
    },
  };
}
