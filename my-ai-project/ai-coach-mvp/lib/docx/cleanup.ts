/**
 * cleanup.ts – DOCX XML 정리 유틸리티
 * 표 셀/텍스트박스에서 불필요한 블루 안내문(run) 및 중첩 테이블 제거
 */

const BLUE_COLORS = [
  "0000FF",
  "0070C0",
  "4472C4",
  "2F5496",
  "5B9BD5",
  "1F4E79",
  "2E75B6",
];

/* ─── helpers ─── */

export function getFirstDirectChild(
  parent: Element,
  tagName: string
): Element | null {
  for (let i = 0; i < parent.childNodes.length; i++) {
    const n = parent.childNodes[i];
    if (n.nodeType === 1 && (n as Element).localName === tagName)
      return n as Element;
  }
  return null;
}

export function directChildrenByTag(
  parent: Element,
  tagName: string
): Element[] {
  const result: Element[] = [];
  for (let i = 0; i < parent.childNodes.length; i++) {
    const n = parent.childNodes[i];
    if (n.nodeType === 1 && (n as Element).localName === tagName)
      result.push(n as Element);
  }
  return result;
}

/** w:r 요소가 블루 색상인지 판별 */
export function isBlueRun(run: Element): boolean {
  const rPr = getFirstDirectChild(run, "rPr");
  if (!rPr) return false;
  const color = getFirstDirectChild(rPr, "color");
  if (!color) return false;
  const val = (color.getAttribute("w:val") || "").toUpperCase();
  return BLUE_COLORS.includes(val);
}

/* ─── cleanup ─── */

/** 표 셀(tc)에서 중첩 테이블과 블루 안내 run 제거 */
export function cleanupCell(tc: Element): void {
  // 중첩 테이블 제거
  const nestedTables = directChildrenByTag(tc, "tbl");
  for (const tbl of nestedTables) {
    tc.removeChild(tbl);
  }

  // 블루 run 제거
  const paragraphs = directChildrenByTag(tc, "p");
  for (const p of paragraphs) {
    const runs = directChildrenByTag(p, "r");
    for (const r of runs) {
      if (isBlueRun(r)) {
        p.removeChild(r);
      }
    }
  }
}

/** 텍스트박스(txbxContent)에서 블루 안내 run 제거 */
export function cleanupTextbox(txbxContent: Element): void {
  const paragraphs = directChildrenByTag(txbxContent, "p");
  for (const p of paragraphs) {
    const runs = directChildrenByTag(p, "r");
    for (const r of runs) {
      if (isBlueRun(r)) {
        p.removeChild(r);
      }
    }
  }
}
