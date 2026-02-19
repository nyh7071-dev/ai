const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');
const fs = require('fs');
const path = require('path');

function getLocalName(node) {
  const name = node?.tagName || node?.nodeName || '';
  const idx = name.indexOf(':');
  return idx >= 0 ? name.slice(idx + 1) : name;
}

function getAllTextboxes(dom) {
  const out = [];
  const root = dom.documentElement;
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (!n) continue;
    if (getLocalName(n) === 'txbxContent') out.push(n);
    if (n.childNodes) {
      for (let i = n.childNodes.length - 1; i >= 0; i--) {
        if (n.childNodes[i].nodeType === 1) stack.push(n.childNodes[i]);
      }
    }
  }
  return out;
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

function getTopLevelTables(dom) {
  const body = dom.getElementsByTagName('w:body')[0];
  if (!body) return [];
  const out = [];
  const kids = body.childNodes || [];
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType !== 1) continue;
    if (getLocalName(n) === 'tbl') out.push(n);
    else if (getLocalName(n) === 'sdt') {
      const sdtKids = n.childNodes || [];
      for (let j = 0; j < sdtKids.length; j++) {
        if (sdtKids[j].nodeType === 1 && getLocalName(sdtKids[j]) === 'sdtContent') {
          const ck = sdtKids[j].childNodes || [];
          for (let k = 0; k < ck.length; k++) {
            if (ck[k].nodeType === 1 && getLocalName(ck[k]) === 'tbl') out.push(ck[k]);
          }
        }
      }
    }
  }
  return out;
}

function getDirectChildren(parent, localName) {
  const out = [];
  if (!parent?.childNodes) return out;
  for (let i = 0; i < parent.childNodes.length; i++) {
    const n = parent.childNodes[i];
    if (n.nodeType === 1 && getLocalName(n) === localName) out.push(n);
  }
  return out;
}

function getCellText(tc) { return getElementText(tc); }

async function analyze(filePath, label) {
  const buf = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('text');
  const dom = new DOMParser().parseFromString(xml, 'text/xml');

  console.log(`\n${'='.repeat(60)}`);
  console.log(`${label}: ${path.basename(filePath)}`);
  console.log(`${'='.repeat(60)}`);

  // Tables
  const tables = getTopLevelTables(dom);
  console.log(`\nTables: ${tables.length}`);
  for (let tIdx = 0; tIdx < tables.length; tIdx++) {
    const rows = getDirectChildren(tables[tIdx], 'tr');
    console.log(`\n--- Table ${tIdx+1} (${rows.length} rows) ---`);
    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      const cells = getDirectChildren(rows[rIdx], 'tc');
      const cellTexts = cells.map(c => getCellText(c).trim().substring(0, 50));
      console.log(`  R${rIdx}: [${cellTexts.join(' | ')}]`);
    }
  }

  // Textboxes
  const textboxes = getAllTextboxes(dom);
  console.log(`\nTextboxes: ${textboxes.length}`);
  for (let i = 0; i < textboxes.length; i++) {
    const text = getElementText(textboxes[i]).trim();
    if (text.length > 0) {
      console.log(`  [${i}] ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`);
    }
  }
}

async function main() {
  const origPath = path.join('c:\\Users\\nyh7071\\Downloads', '[별첨 1] 2025년도 예비창업패키지 사업계획서 양식.docx');
  const filledPath = path.join('c:\\Users\\nyh7071\\Downloads', 'filled_[별첨 1] 2025년도 예비창업패키지 사업계획서 양식 (35).docx');

  await analyze(origPath, 'ORIGINAL');
  await analyze(filledPath, 'FILLED');

  // Quick diff summary
  console.log('\n\n========== DIFF SUMMARY ==========');
  const origBuf = fs.readFileSync(origPath);
  const filledBuf = fs.readFileSync(filledPath);
  const origZip = await JSZip.loadAsync(origBuf);
  const filledZip = await JSZip.loadAsync(filledBuf);
  const origXml = await origZip.file('word/document.xml').async('text');
  const filledXml = await filledZip.file('word/document.xml').async('text');
  const origDom = new DOMParser().parseFromString(origXml, 'text/xml');
  const filledDom = new DOMParser().parseFromString(filledXml, 'text/xml');

  // Compare textboxes
  const origTxb = getAllTextboxes(origDom);
  const filledTxb = getAllTextboxes(filledDom);
  let txbChanged = 0;
  for (let i = 0; i < Math.max(origTxb.length, filledTxb.length); i++) {
    const o = getElementText(origTxb[i] || {}).trim();
    const f = getElementText(filledTxb[i] || {}).trim();
    if (o !== f) {
      txbChanged++;
      console.log(`TXB[${i}] CHANGED:`);
      console.log(`  ORIG: ${o.substring(0, 80)}`);
      console.log(`  FILL: ${f.substring(0, 80)}`);
    }
  }
  console.log(`\nTextboxes changed: ${txbChanged}/${Math.max(origTxb.length, filledTxb.length)}`);

  // Compare table 4 (overview)
  const origTables = getTopLevelTables(origDom);
  const filledTables = getTopLevelTables(filledDom);
  console.log('\n--- Table 4 comparison ---');
  if (origTables[3] && filledTables[3]) {
    const origRows = getDirectChildren(origTables[3], 'tr');
    const filledRows = getDirectChildren(filledTables[3], 'tr');
    for (let r = 0; r < Math.max(origRows.length, filledRows.length); r++) {
      const oCells = origRows[r] ? getDirectChildren(origRows[r], 'tc') : [];
      const fCells = filledRows[r] ? getDirectChildren(filledRows[r], 'tc') : [];
      for (let c = 0; c < Math.max(oCells.length, fCells.length); c++) {
        const oText = oCells[c] ? getCellText(oCells[c]).trim().substring(0, 60) : '';
        const fText = fCells[c] ? getCellText(fCells[c]).trim().substring(0, 60) : '';
        if (oText !== fText) {
          console.log(`  R${r}C${c} CHANGED: "${oText}" → "${fText}"`);
        }
      }
    }
  }
}

main().catch(console.error);
