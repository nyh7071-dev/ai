/**
 * lib/docx/cleanup.ts
 *
 * DOCX 셀/텍스트박스 클린업 유틸리티
 * - nested table 제거
 * - 파란색 run 제거
 * - 예시/가이드 텍스트 제거
 */

function getFirstDirectChild(parent: any, tagName: string): any | null {
  const kids = parent.childNodes || [];
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType === 1 && n.tagName === tagName) return n;
  }
  return null;
}

function directChildrenByTag(parent: any, tagName: string): any[] {
  const out: any[] = [];
  const kids = parent.childNodes || [];
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType === 1 && n.tagName === tagName) out.push(n);
  }
  return out;
}

/**
 * w:rPr에 파란색 계열 color가 있는지 확인
 */
function isBlueRun(rPr: any): boolean {
  if (!rPr) return false;
  const color = getFirstDirectChild(rPr, 'w:color');
  if (!color) return false;
  const val = (color.getAttribute('w:val') || '').toUpperCase();
  // 파란색 계열 (0000FF, 0070C0, 4472C4, 2F5496, 5B9BD5 등)
  const blueColors = ['0000FF', '0070C0', '4472C4', '2F5496', '5B9BD5', '1F4E79', '2E75B6'];
  return blueColors.includes(val);
}

/**
 * w:tc 셀 클린업
 * - nested table (w:tbl) 제거
 * - 파란색 run 제거
 */
export function cleanupCell(tc: any): void {
  // nested table 제거
  const nestedTables = directChildrenByTag(tc, 'w:tbl');
  for (const tbl of nestedTables) {
    tc.removeChild(tbl);
  }

  // 각 paragraph의 파란색 run 제거
  const paras = directChildrenByTag(tc, 'w:p');
  for (const p of paras) {
    const runs = directChildrenByTag(p, 'w:r');
    for (const r of runs) {
      const rPr = getFirstDirectChild(r, 'w:rPr');
      if (isBlueRun(rPr)) {
        p.removeChild(r);
      }
    }
  }
}

/**
 * w:txbxContent 텍스트박스 클린업
 * - 파란색 run 제거
 */
export function cleanupTextbox(txbxContent: any): void {
  const paras = directChildrenByTag(txbxContent, 'w:p');
  for (const p of paras) {
    const runs = directChildrenByTag(p, 'w:r');
    for (const r of runs) {
      const rPr = getFirstDirectChild(r, 'w:rPr');
      if (isBlueRun(rPr)) {
        p.removeChild(r);
      }
    }
  }
}
