// Test: scanner vs fillDocx textbox ordering
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

// METHOD A: Scanner's getAllElements (pushes ALL child nodes)
function scannerGetAllElements(dom, localName) {
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
        stack.push(n.childNodes[i]); // ALL nodes
      }
    }
  }
  return out;
}

// METHOD B: fillDocx's getAllTextboxes (pushes only ELEMENT nodes)
function fillDocxGetAllTextboxes(dom) {
  const out = [];
  const stack = [dom.documentElement];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    const tagName = node.tagName || '';
    const localName = tagName.indexOf(':') >= 0 ? tagName.slice(tagName.indexOf(':') + 1) : tagName;
    if (localName === 'txbxContent') out.push(node);
    if (node.childNodes) {
      for (let i = node.childNodes.length - 1; i >= 0; i--) {
        const child = node.childNodes[i];
        if (child.nodeType === 1) stack.push(child); // ELEMENT nodes only
      }
    }
  }
  return out;
}

async function main() {
  const filePath = 'c:\\Users\\nyh7071\\Downloads\\[별첨 1] 2025년도 예비창업패키지 사업계획서 양식.docx';
  const buf = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('text');
  const dom = new DOMParser().parseFromString(xml, 'text/xml');

  const methodA = scannerGetAllElements(dom, 'txbxContent');
  const methodB = fillDocxGetAllTextboxes(dom);

  console.log(`Method A (scanner): ${methodA.length} textboxes`);
  console.log(`Method B (fillDocx): ${methodB.length} textboxes`);
  console.log();

  // Compare
  const maxLen = Math.max(methodA.length, methodB.length);
  let mismatches = 0;
  for (let i = 0; i < maxLen; i++) {
    const aText = methodA[i] ? getElementText(methodA[i]).trim().substring(0, 60) : '(none)';
    const bText = methodB[i] ? getElementText(methodB[i]).trim().substring(0, 60) : '(none)';
    const match = aText === bText ? 'OK' : 'MISMATCH';
    if (match === 'MISMATCH') {
      mismatches++;
      console.log(`[${i}] ${match}`);
      console.log(`  A: ${aText}`);
      console.log(`  B: ${bText}`);
    }
  }
  console.log(`\nTotal mismatches: ${mismatches}/${maxLen}`);

  // Also show scanner's dedup order
  console.log('\n--- Scanner with dedup (what slots are generated) ---');
  const seenTexts = new Set();
  for (let i = 0; i < methodA.length; i++) {
    const text = getElementText(methodA[i]).trim();
    if (!text || text.length === 0) continue;
    const textKey = text.substring(0, 80);
    if (seenTexts.has(textKey)) continue;
    seenTexts.add(textKey);
    console.log(`  TEXTBOX_${i}: ${text.substring(0, 70)}`);
  }
}

main().catch(console.error);
