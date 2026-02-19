// Debug: body 자식 구조 - "문제 인식" 섹션 주변 상세 분석
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');
const fs = require('fs');
const path = require('path');

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

function hasTextbox(node) {
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

// 문단의 번호매기기(w:numPr) 확인
function getNumPr(p) {
  const pPr = null;
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

async function main() {
  const origPath = path.join('C:\\Users\\nyh7071\\Downloads', '[별첨 1] 2025년도 예비창업패키지 사업계획서 양식.docx');
  const buf = fs.readFileSync(origPath);
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('text');
  const dom = new DOMParser().parseFromString(xml, 'text/xml');

  const body = dom.getElementsByTagName('w:body')[0];
  if (!body) return;

  const kids = body.childNodes || [];
  console.log(`Body 직계 자식 수: ${kids.length}`);
  console.log('\n=== Body children #15 ~ #35 (문제인식 섹션 주변) ===\n');

  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType !== 1) continue;

    // 15~35 범위만 상세 출력, 나머지는 요약
    if (i < 15 || i > 35) {
      const text = getElementText(n).trim();
      if (text.includes('○') || text.includes('문제') || text.includes('시장') || text.includes('Problem')) {
        console.log(`  [${i}] <${n.tagName}> "${text.substring(0, 100)}"`);
      }
      continue;
    }

    const tag = n.tagName || '';
    const text = getElementText(n).trim();
    const hasTxbx = hasTextbox(n);
    const numPr = getLocalName(n) === 'p' ? getNumPr(n) : null;

    let extra = '';
    if (hasTxbx) extra += ' [HAS_TEXTBOX]';
    if (numPr) extra += ` [numPr: numId=${numPr.numId}, ilvl=${numPr.ilvl}]`;

    console.log(`  [${i}] <${tag}>${extra}`);
    if (text) {
      console.log(`    text: "${text.substring(0, 150)}${text.length > 150 ? '...' : ''}"`);
    } else {
      console.log(`    text: (empty)`);
    }
  }

  // Also check: body paragraphs that have ○ text
  console.log('\n=== All body <w:p> with ○ or bullet-like text ===\n');
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType !== 1) continue;
    if (getLocalName(n) !== 'p') continue;

    const text = getElementText(n).trim();
    const numPr = getNumPr(n);

    if (text === '○' || text === '-' || text === '' || /^[○●\-\s]+$/.test(text) || numPr) {
      // This is a bullet-like paragraph
      if (numPr || text === '○' || text === '-') {
        console.log(`  body[${i}] <w:p> text="${text || '(empty)'}" ${numPr ? `numPr(numId=${numPr.numId}, ilvl=${numPr.ilvl})` : ''}`);
      }
    }
  }
}

main().catch(console.error);
