// Test: body section detection and fill simulation
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

function containsTextbox(node) {
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

function hasNumPr(p) {
  if (!p.childNodes) return false;
  for (let i = 0; i < p.childNodes.length; i++) {
    const child = p.childNodes[i];
    if (child.nodeType === 1 && getLocalName(child) === 'pPr') {
      for (let j = 0; j < child.childNodes.length; j++) {
        if (child.childNodes[j].nodeType === 1 && getLocalName(child.childNodes[j]) === 'numPr') return true;
      }
    }
  }
  return false;
}

async function main() {
  const filePath = path.join('C:\\Users\\nyh7071\\Downloads', '[별첨 1] 2025년도 예비창업패키지 사업계획서 양식.docx');
  const buf = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('text');
  const dom = new DOMParser().parseFromString(xml, 'text/xml');

  const body = dom.getElementsByTagName('w:body')[0];
  const kids = body.childNodes || [];

  // Scanner generates these signatures
  const sectionSignatures = [
    "1문제인식Problem창업아이템의필요성",
    "2실현가능성Solution창업아이템의개발계획",
    "3성장전략Scaleup사업화추진전략",
  ];

  console.log('=== Fill Body Section Match Test ===\n');

  for (const targetSig of sectionSignatures) {
    let found = false;
    for (let i = 0; i < kids.length; i++) {
      const n = kids[i];
      if (n.nodeType !== 1) continue;
      if (!containsTextbox(n)) continue;

      const text = getElementText(n).trim();
      // Try full text signature
      const fullSig = text.substring(0, 60).replace(/[^가-힣a-zA-Z0-9]/g, '').substring(0, 30);
      // Try half text signature (mc:Choice/Fallback doubles the text)
      const halfText = text.substring(0, Math.floor(text.length / 2));
      const halfSig = halfText.substring(0, 60).replace(/[^가-힣a-zA-Z0-9]/g, '').substring(0, 30);

      if (fullSig === targetSig || halfSig === targetSig) {
        console.log(`✅ FOUND at body[${i}]: sig="${targetSig}"`);
        console.log(`   fullSig="${fullSig}", halfSig="${halfSig}"`);

        // Simulate finding content paragraphs after it
        let contentStart = -1, contentEnd = -1, toRemoveCount = 0;
        let circleCount = 0, bulletCount = 0;

        for (let j = i + 1; j < kids.length; j++) {
          const m = kids[j];
          if (m.nodeType !== 1) continue;
          const tag = getLocalName(m);
          const mText = getElementText(m).trim();
          const hasTxbx = containsTextbox(m);

          if (hasTxbx) continue; // skip guide textbox
          if (tag === 'tbl') break; // end at table

          if (tag === 'p') {
            const isCircle = mText === 'ㅇ' || mText === '○';
            const isEmpty = !mText || mText.length === 0;
            const isBullet = hasNumPr(m);

            if (isCircle || isEmpty || isBullet) {
              if (contentStart === -1) contentStart = j;
              contentEnd = j;
              toRemoveCount++;
              if (isCircle) circleCount++;
              if (isBullet) bulletCount++;
            } else {
              break;
            }
          }
        }

        console.log(`   content: body[${contentStart}..${contentEnd}] = ${toRemoveCount} paras (ㅇ:${circleCount}, bullets:${bulletCount})`);
        found = true;
        break;
      }
    }
    if (!found) {
      console.log(`❌ NOT FOUND: sig="${targetSig}"`);
    }
    console.log();
  }
}

main().catch(console.error);
