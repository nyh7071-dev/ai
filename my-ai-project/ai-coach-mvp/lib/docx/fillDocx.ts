/**
 * fillDocx.ts – DOCX 슬롯을 AI 생성 콘텐츠로 채움
 *
 * xmlPath 형식:
 *   document:body_section:{signature}
 *   document:textbox:{signature}
 *   document:table[t]:row[r]:cell[c]
 */

import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import {
  cleanupCell,
  cleanupTextbox,
  getFirstDirectChild,
  directChildrenByTag,
} from "./cleanup";

/* ─── types ─── */

export interface FillOp {
  key: string;
  xmlPath: string;
  value: string;
}

interface ParsedPath {
  type: "body_section" | "textbox" | "table_cell";
  signature?: string;
  bodySectionTitle?: string;
  tableIdx?: number;
  rowIdx?: number;
  cellIdx?: number;
}

/* ─── path parser ─── */

function parsePath(xmlPath: string): ParsedPath | null {
  if (xmlPath.startsWith("document:body_section:")) {
    const sig = xmlPath.replace("document:body_section:", "");
    return { type: "body_section", signature: sig, bodySectionTitle: sig };
  }
  if (xmlPath.startsWith("document:textbox:")) {
    const sig = xmlPath.replace("document:textbox:", "");
    return { type: "textbox", signature: sig };
  }
  const tableMatch = xmlPath.match(
    /^document:table\[(\d+)\]:row\[(\d+)\]:cell\[(\d+)\]$/
  );
  if (tableMatch) {
    return {
      type: "table_cell",
      tableIdx: parseInt(tableMatch[1]),
      rowIdx: parseInt(tableMatch[2]),
      cellIdx: parseInt(tableMatch[3]),
    };
  }
  return null;
}

/* ─── signature helper ─── */

function makeSignature(text: string): string {
  return text
    .substring(0, 60)
    .replace(/[^가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9]/g, "")
    .substring(0, 30);
}

/* ─── text extraction ─── */

function extractDirectText(p: Element): string {
  const texts: string[] = [];
  const runs = directChildrenByTag(p, "r");
  for (const r of runs) {
    const tEl = getFirstDirectChild(r, "t");
    if (tEl) texts.push(tEl.textContent || "");
  }
  return texts.join("").trim();
}

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

/* ─── body section title detection ─── */

function isBodySectionTitle(p: Element): boolean {
  const text = extractDirectText(p);
  if (!text) return false;
  if (/^[ㅇ○]/.test(text)) return true;
  if (/^\d+[\.\)]/.test(text)) return true;
  if (/^\(\d+\)/.test(text)) return true;
  if (/^[가-힣][\.\)]/.test(text) && text.length > 2) return true;
  if (/^※/.test(text)) return true;
  if (/^[□■▶▷●◆]/.test(text)) return true;
  if (/^[IVX]+[\.\)]/.test(text)) return true;
  if (/^[\u2160-\u216F\u2170-\u217F]/.test(text)) return true;
  if (/^제\d+[장절항]/.test(text)) return true;
  if (/^【/.test(text)) return true;
  if (/^\[.+\]/.test(text)) return true;
  if (/^[가-힣a-zA-Z\s]{1,15}\s*:\s*.+/.test(text)) return true;
  const pPr = getFirstDirectChild(p, "pPr");
  if (pPr) {
    if (getFirstDirectChild(pPr, "numPr")) return true;
    const pStyle = getFirstDirectChild(pPr, "pStyle");
    if (pStyle) {
      const val = (pStyle.getAttribute("w:val") || "").toLowerCase();
      if (/heading|제목|title|toc/.test(val)) return true;
      if (/^\d+$/.test(val)) return true;
    }
    if (getFirstDirectChild(pPr, "outlineLvl")) return true;
  }
  return false;
}

/* ─── create paragraph XML ─── */

function createParagraphRuns(
  doc: Document,
  text: string,
  templateRun?: Element | null
): Element {
  const p = doc.createElementNS(
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "w:p"
  );

  const lines = text.split("\n");
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].trim();
    if (!line) continue;

    const r = doc.createElementNS(
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
      "w:r"
    );

    // 기존 run 스타일 복사
    if (templateRun) {
      const rPr = getFirstDirectChild(templateRun, "rPr");
      if (rPr) {
        r.appendChild(rPr.cloneNode(true));
      }
    }

    const t = doc.createElementNS(
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
      "w:t"
    );
    t.setAttribute("xml:space", "preserve");
    t.textContent = line;
    r.appendChild(t);
    p.appendChild(r);

    // 줄바꿈 처리 (마지막 줄 제외)
    if (li < lines.length - 1) {
      const brR = doc.createElementNS(
        "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        "w:r"
      );
      const br = doc.createElementNS(
        "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        "w:br"
      );
      brR.appendChild(br);
      p.appendChild(brR);
    }
  }

  return p;
}

/* ─── flatten body children (SDT 언래핑) ─── */

interface FlatChild {
  el: Element;
  parent: Element; // 실제 부모 (body 또는 sdtContent)
}

function flattenBodyForFill(body: Element): FlatChild[] {
  const result: FlatChild[] = [];
  for (let i = 0; i < body.childNodes.length; i++) {
    const n = body.childNodes[i];
    if (n.nodeType !== 1) continue;
    const el = n as Element;
    if (el.localName === "sdt") {
      const sdtContent = getFirstDirectChild(el, "sdtContent");
      if (sdtContent) {
        for (let j = 0; j < sdtContent.childNodes.length; j++) {
          const inner = sdtContent.childNodes[j];
          if (inner.nodeType === 1) result.push({ el: inner as Element, parent: sdtContent });
        }
      }
    } else {
      result.push({ el, parent: body });
    }
  }
  return result;
}

/* ─── fill body section ─── */

function fillBodySection(
  dom: Document,
  signature: string,
  value: string
): boolean {
  const body = dom.getElementsByTagName("w:body")[0];
  if (!body) return false;

  // SDT 언래핑 포함한 평탄화
  const children = flattenBodyForFill(body);

  // 시그니처로 타이틀 찾기
  let titleIdx = -1;
  const halfSig = signature.substring(0, 20);

  for (let i = 0; i < children.length; i++) {
    const { el } = children[i];
    if (el.localName !== "p") continue;
    if (!isBodySectionTitle(el)) continue;

    const text = extractDirectText(el);
    const elSig = makeSignature(text);
    if (elSig === signature || elSig.substring(0, 20) === halfSig) {
      titleIdx = i;
      break;
    }
  }

  if (titleIdx === -1) {
    console.warn(`[fillBodySection] 시그니처 미발견: ${signature}`);
    return false;
  }

  // 타이틀 이후 본문 단락 수집
  const toRemove: FlatChild[] = [];
  let templateRun: Element | null = null;

  for (let j = titleIdx + 1; j < children.length; j++) {
    const { el } = children[j];
    if (el.localName === "p") {
      if (isBodySectionTitle(el)) break;
      if (!templateRun) {
        const runs = directChildrenByTag(el, "r");
        if (runs.length > 0) templateRun = runs[0];
      }
      toRemove.push(children[j]);
    } else if (el.localName === "tbl") {
      break;
    } else {
      toRemove.push(children[j]);
    }
  }

  // 기존 본문 단락 제거 (각 요소의 실제 부모에서 제거)
  for (const { el, parent } of toRemove) {
    parent.removeChild(el);
  }

  // AI 콘텐츠로 새 단락 생성
  const paragraphs = value.split("\n").filter((l) => l.trim());

  // 삽입 위치: 타이틀 다음 노드 (실제 부모 기준)
  const titleChild = children[titleIdx];
  const insertParent = titleChild.parent;
  const refNode = titleChild.el.nextSibling;

  for (const paraText of paragraphs) {
    const newP = createParagraphRuns(dom, paraText, templateRun);
    if (refNode) {
      insertParent.insertBefore(newP, refNode);
    } else {
      insertParent.appendChild(newP);
    }
  }

  console.log(
    `[fillBodySection] 채움 완료: ${signature} (${toRemove.length}→${paragraphs.length} 단락)`
  );
  return true;
}

/* ─── fill textbox ─── */

function fillTextbox(dom: Document, signature: string, value: string): boolean {
  const txbxContents = dom.getElementsByTagName("w:txbxContent");
  const halfSig = signature.substring(0, 20);

  for (let i = 0; i < txbxContents.length; i++) {
    const txbx = txbxContents[i] as Element;
    const text = extractText(txbx);
    const elSig = makeSignature(text);

    if (elSig === signature || elSig.substring(0, 20) === halfSig) {
      cleanupTextbox(txbx);

      // 기존 단락 제거
      const paragraphs = directChildrenByTag(txbx, "p");
      let templateRun: Element | null = null;
      for (const p of paragraphs) {
        const runs = directChildrenByTag(p, "r");
        if (!templateRun && runs.length > 0) templateRun = runs[0];
        txbx.removeChild(p);
      }

      // 새 콘텐츠 삽입
      const lines = value.split("\n").filter((l) => l.trim());
      for (const line of lines) {
        const newP = createParagraphRuns(dom, line, templateRun);
        txbx.appendChild(newP);
      }

      console.log(`[fillTextbox] 채움 완료: ${signature}`);
      return true;
    }
  }

  console.warn(`[fillTextbox] 시그니처 미발견: ${signature}`);
  return false;
}

/* ─── fill table cell ─── */

function fillTableCell(
  dom: Document,
  tableIdx: number,
  rowIdx: number,
  cellIdx: number,
  value: string
): boolean {
  // 모든 테이블 (중첩 테이블, 텍스트박스 내부 테이블 포함)
  const allTables: Element[] = [];
  const tblNodes = dom.getElementsByTagName("w:tbl");
  for (let i = 0; i < tblNodes.length; i++) {
    allTables.push(tblNodes[i] as Element);
  }

  if (tableIdx >= allTables.length) return false;
  const tbl = allTables[tableIdx];
  // directChildrenByTag: 직접 자식만 (중첩 테이블 행/셀 제외)
  const rows = directChildrenByTag(tbl, "tr");
  if (rowIdx >= rows.length) return false;
  const row = rows[rowIdx];
  const cells = directChildrenByTag(row, "tc");
  if (cellIdx >= cells.length) return false;
  const cell = cells[cellIdx];

  cleanupCell(cell);

  // 기존 단락 제거
  const paragraphs = directChildrenByTag(cell, "p");
  let templateRun: Element | null = null;
  for (const p of paragraphs) {
    const runs = directChildrenByTag(p, "r");
    if (!templateRun && runs.length > 0) templateRun = runs[0];
    cell.removeChild(p);
  }

  // 새 콘텐츠 삽입
  const lines = value.split("\n").filter((l) => l.trim());
  if (lines.length === 0) {
    // 빈 단락 하나는 필수
    const emptyP = dom.createElementNS(
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
      "w:p"
    );
    cell.appendChild(emptyP);
  } else {
    for (const line of lines) {
      const newP = createParagraphRuns(dom, line, templateRun);
      cell.appendChild(newP);
    }
  }

  return true;
}

/* ─── main entry ─── */

export async function fillDocx(
  docxBuffer: ArrayBuffer,
  ops: FillOp[]
): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(docxBuffer);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) throw new Error("word/document.xml not found in DOCX");

  const dom = new DOMParser().parseFromString(documentXml, "text/xml");

  let filled = 0;
  for (const op of ops) {
    const parsed = parsePath(op.xmlPath);
    if (!parsed) {
      console.warn(`[fillDocx] 파싱 불가: ${op.xmlPath}`);
      continue;
    }

    let ok = false;
    switch (parsed.type) {
      case "body_section":
        ok = fillBodySection(dom, parsed.signature || "", op.value);
        break;
      case "textbox":
        ok = fillTextbox(dom, parsed.signature || "", op.value);
        break;
      case "table_cell":
        ok = fillTableCell(
          dom,
          parsed.tableIdx ?? 0,
          parsed.rowIdx ?? 0,
          parsed.cellIdx ?? 0,
          op.value
        );
        break;
    }
    if (ok) filled++;
  }

  console.log(`[fillDocx] ${filled}/${ops.length} 슬롯 채움 완료`);

  const serializer = new XMLSerializer();
  const newXml = serializer.serializeToString(dom);
  zip.file("word/document.xml", newXml);

  const outBuf = await zip.generateAsync({ type: "arraybuffer" });
  return outBuf;
}
