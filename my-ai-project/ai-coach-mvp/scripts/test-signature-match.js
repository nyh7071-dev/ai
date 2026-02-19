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
        stack.push(n.childNodes[i]);
      }
    }
  }
  return out;
}

function isTextboxFillable(text) {
  if (text.startsWith('※')) return true;
  if (/^OO|^○○|^OOOOO/.test(text)) return true;
  if (/^\.{2,}$|^…$/.test(text.trim())) return true;
  const PLACEHOLDER_PATTERNS = [
    /^※/, /^OO/, /^oo/i, /^\d{2}\.\d{2}$/, /^\d{2}\.\d{2}\.\d{2}$/,
    /\d{2}\.\d{2}\s*~\s*\d{2}\.\d{2}/, /^_+$/, /^\.{2,}$/, /^…$/,
    /예시\s*[:：]/, /^\(\s*\)$/, /^\[\s*\]$/, /^○/, /^□/,
    /'\d{2}\.\d{2}/, /\(0+개\)/, /0+명/, /0+년/, /0+원/,
  ];
  for (const p of PLACEHOLDER_PATTERNS) if (p.test(text)) return true;
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

  console.log('=== Scanner generates these slots ===\n');
  let slotIndex = 0;
  const slots = [];
  for (let i = 0; i < textboxes.length; i++) {
    const text = getElementText(textboxes[i]).trim();
    if (!text || text.length === 0) continue;
    const textKey = text.substring(0, 80);
    if (seenTexts.has(textKey)) continue;
    seenTexts.add(textKey);
    if (isTextboxFillable(text)) {
      const contentSignature = text.substring(0, 60).replace(/[^가-힣a-zA-Z0-9]/g, '').substring(0, 30);
      const xmlPath = `document:txbx_match:${contentSignature}`;
      console.log(`TEXTBOX_${slotIndex}: xmlPath="${xmlPath}"`);
      console.log(`  text: "${text.substring(0, 70)}"`);
      slots.push({ sig: contentSignature, origIndex: i, text: text.substring(0, 60) });
      slotIndex++;
    }
  }

  console.log('\n=== fillDocx matching test ===\n');
  // Simulate fillDocx matching: for each slot, find the textbox by content
  for (const slot of slots) {
    let found = false;
    for (let ti = 0; ti < textboxes.length; ti++) {
      const txbxText = getElementText(textboxes[ti]).trim();
      const txbxSig = txbxText.substring(0, 60).replace(/[^가-힣a-zA-Z0-9]/g, '').substring(0, 30);
      if (txbxSig === slot.sig) {
        const correct = ti === slot.origIndex;
        console.log(`sig="${slot.sig}" → textbox[${ti}] ${correct ? '✓ CORRECT' : `✗ WRONG (expected ${slot.origIndex})`}`);
        found = true;
        break;
      }
    }
    if (!found) console.log(`sig="${slot.sig}" → NOT FOUND!`);
  }
}

main().catch(console.error);
