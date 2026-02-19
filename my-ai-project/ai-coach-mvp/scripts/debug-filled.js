// Debug: 최신 filled 파일의 "문제 인식" 섹션 주변 내용 확인
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

function getDirectChildren(parent, localName) {
  const out = [];
  if (!parent?.childNodes) return out;
  for (let i = 0; i < parent.childNodes.length; i++) {
    const n = parent.childNodes[i];
    if (n.nodeType === 1 && getLocalName(n) === localName) out.push(n);
  }
  return out;
}

function getAllTextboxes(dom) {
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
        if (node.childNodes[i].nodeType === 1) stack.push(node.childNodes[i]);
      }
    }
  }
  return out;
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

async function analyze(filePath, label) {
  const buf = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('text');
  const dom = new DOMParser().parseFromString(xml, 'text/xml');

  console.log(`\n${'='.repeat(60)}`);
  console.log(`${label}: ${path.basename(filePath)}`);
  console.log(`${'='.repeat(60)}`);

  // Textboxes
  const textboxes = getAllTextboxes(dom);
  const seenTexts = new Set();
  console.log(`\nTextboxes: ${textboxes.length} (unique):`);
  for (let i = 0; i < textboxes.length; i++) {
    const text = getElementText(textboxes[i]).trim();
    if (!text) continue;
    const textKey = text.substring(0, 80);
    if (seenTexts.has(textKey)) continue;
    seenTexts.add(textKey);
    // "문제 인식" 관련 텍스트만 출력
    if (text.includes('문제') || text.includes('시장') || text.includes('Problem') ||
        text.includes('실현') || text.includes('Solution') || text.includes('성장') ||
        text.includes('Scale') || text.includes('팀 구성') || text.includes('Team') ||
        text.includes('○') || text.startsWith('※')) {
      console.log(`  [${i}] "${text.substring(0, 150)}${text.length > 150 ? '...' : ''}"`);
    }
  }

  // Body 직계 구조 확인
  const body = dom.getElementsByTagName('w:body')[0];
  if (body) {
    console.log('\n--- Body 직계 자식 구조 (문제 인식 섹션 찾기) ---');
    const kids = body.childNodes || [];
    for (let i = 0; i < kids.length; i++) {
      const n = kids[i];
      if (n.nodeType !== 1) continue;
      const tag = n.tagName || '';
      const text = getElementText(n).trim();
      // 관련 텍스트 포함하는 것만
      if (text.includes('시장 현황') || text.includes('문제점을 분석') ||
          text.includes('투자 가능성') || text.includes('○')) {
        console.log(`  body child[${i}] <${tag}>: "${text.substring(0, 200)}"`);
      }
    }
  }

  // 모든 테이블의 셀 내용 중 "시장" 또는 "○" 포함하는 것 찾기
  const tables = getTopLevelTables(dom);
  console.log(`\n--- Tables with relevant content ---`);
  for (let tIdx = 0; tIdx < tables.length; tIdx++) {
    const rows = getDirectChildren(tables[tIdx], 'tr');
    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      const cells = getDirectChildren(rows[rIdx], 'tc');
      for (let cIdx = 0; cIdx < cells.length; cIdx++) {
        const text = getElementText(cells[cIdx]).trim();
        if (text.includes('시장 현황') || text.includes('문제점을 분석') ||
            text.includes('투자 가능성') || (text.includes('○') && text.length < 10)) {
          console.log(`  Table${tIdx+1}:R${rIdx}:C${cIdx}: "${text.substring(0, 200)}"`);
        }
      }
    }
  }
}

async function main() {
  // Find latest filled file
  const downloadDir = 'C:\\Users\\nyh7071\\Downloads';
  const files = fs.readdirSync(downloadDir)
    .filter(f => f.startsWith('filled_') && f.endsWith('.docx'))
    .map(f => ({ name: f, path: path.join(downloadDir, f), mtime: fs.statSync(path.join(downloadDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length > 0) {
    console.log(`Latest filled: ${files[0].name}`);
    await analyze(files[0].path, 'FILLED (latest)');
  }

  // Also check original
  const origPath = path.join(downloadDir, '[별첨 1] 2025년도 예비창업패키지 사업계획서 양식.docx');
  if (fs.existsSync(origPath)) {
    await analyze(origPath, 'ORIGINAL');
  }
}

main().catch(console.error);
