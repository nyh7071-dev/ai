// Debug: 모든 텍스트박스의 내용과 fillable 여부 확인
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');
const fs = require('fs');

function getLocalName(node) {
  const name = node?.tagName || node?.nodeName || '';
  const idx = name.indexOf(':');
  return idx >= 0 ? name.slice(idx + 1) : name;
}

function getElementText(node) {
  const texts = [];
  const stack = [node];
  while (stack.length > 0) {
    const n = stack.pop();
    if (!n) continue;
    if (getLocalName(n) === 't') texts.push(n.textContent || '');
    if (n.childNodes) {
      for (let i = n.childNodes.length - 1; i >= 0; i--) {
        if (n.childNodes[i].nodeType === 1) stack.push(n.childNodes[i]);
      }
    }
  }
  return texts.join('');
}

function getAllElements(dom, localName) {
  const out = [];
  const root = dom?.documentElement;
  if (!root) return out;
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (!n) continue;
    if (getLocalName(n) === localName) out.push(n);
    if (n.childNodes) {
      for (let i = n.childNodes.length - 1; i >= 0; i--) {
        if (n.childNodes[i].nodeType === 1) stack.push(n.childNodes[i]);
      }
    }
  }
  return out;
}

// 현재 isTextboxFillable 함수 (universalSlotScanner에서 복사)
const PLACEHOLDER_PATTERNS = [
  /^※/, /^OO/, /^oo/i, /^\d{2}\.\d{2}$/, /^\d{2}\.\d{2}\.\d{2}$/,
  /\d{2}\.\d{2}\s*~\s*\d{2}\.\d{2}/, /^_+$/, /^\.{2,}$/, /^…$/,
  /예시\s*[:：]/, /^\(\s*\)$/, /^\[\s*\]$/, /^○/, /^□/,
  /'\d{2}\.\d{2}/, /\(0+개\)/, /0+명/, /0+년/, /0+원/,
];

function isTextboxFillable(text) {
  if (text.startsWith('※')) return true;
  if (/^OO|^○○|^OOOOO/.test(text)) return true;
  if (/^\.{2,}$|^…$/.test(text.trim())) return true;
  for (const p of PLACEHOLDER_PATTERNS) if (p.test(text)) return true;
  return false;
}

// 텍스트가 파란색 run을 포함하는지 확인
function hasBlueRuns(txbxContent) {
  const runs = getAllElements({ documentElement: txbxContent }, 'r');
  for (const r of runs) {
    const rPr = null;
    // rPr 안에 color 확인
    if (r.childNodes) {
      for (let i = 0; i < r.childNodes.length; i++) {
        const child = r.childNodes[i];
        if (child.nodeType === 1 && getLocalName(child) === 'rPr') {
          // rPr 안의 color 태그 확인
          for (let j = 0; j < child.childNodes.length; j++) {
            const gc = child.childNodes[j];
            if (gc.nodeType === 1 && getLocalName(gc) === 'color') {
              const val = gc.getAttribute('w:val') || gc.getAttribute('val') || '';
              if (val.toLowerCase() === '0000ff' || val.toLowerCase() === '0070c0' || val.toLowerCase() === '4472c4') {
                return true;
              }
            }
          }
        }
      }
    }
  }
  return false;
}

async function main() {
  const filePath = 'c:\\Users\\nyh7071\\Downloads\\[별첨 1] 2025년도 예비창업패키지 사업계획서 양식.docx';
  const buf = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('text');
  const dom = new DOMParser().parseFromString(xml, 'text/xml');

  const textboxes = getAllElements(dom, 'txbxContent');
  const seenTexts = new Set();

  console.log(`총 텍스트박스 수: ${textboxes.length}\n`);

  for (let i = 0; i < textboxes.length; i++) {
    const text = getElementText(textboxes[i]).trim();
    if (!text || text.length === 0) continue;

    const textKey = text.substring(0, 80);
    const isDup = seenTexts.has(textKey);
    seenTexts.add(textKey);

    const fillable = isTextboxFillable(text);
    const blue = hasBlueRuns(textboxes[i]);

    const status = fillable ? '✅ FILLABLE' : (blue ? '🔵 BLUE(미감지!)' : '⬜ SKIP');
    const dupMark = isDup ? ' [DUP]' : '';

    console.log(`[${i}] ${status}${dupMark}`);
    console.log(`  text: "${text.substring(0, 120)}${text.length > 120 ? '...' : ''}"`);
    if (text.includes('○') || text.includes('시장') || text.includes('문제')) {
      console.log(`  ⚠️ 이 텍스트박스는 채워야 할 내용일 수 있음!`);
    }
    console.log();
  }
}

main().catch(console.error);
