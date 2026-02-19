// 최신 filled 파일의 body section 영역 확인
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

async function analyze(filePath, label) {
  const buf = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('text');
  const dom = new DOMParser().parseFromString(xml, 'text/xml');

  const body = dom.getElementsByTagName('w:body')[0];
  const kids = body.childNodes || [];

  console.log(`\n${'='.repeat(60)}`);
  console.log(`${label}`);
  console.log(`${'='.repeat(60)}`);

  // "문제 인식" 섹션 주변 (body[15]~body[60]) 상세 출력
  console.log('\n--- Body children around "문제 인식" section ---\n');
  for (let i = 15; i < Math.min(kids.length, 65); i++) {
    const n = kids[i];
    if (n.nodeType !== 1) continue;
    const tag = getLocalName(n);
    const text = getElementText(n).trim();
    const hasTxbx = containsTextbox(n);
    const numPr = hasNumPr(n);

    let label = '';
    if (tag === 'tbl') label = '[TABLE]';
    else if (hasTxbx) label = '[TXBX]';
    else if (numPr) label = '[BULLET]';
    else if (text === 'ㅇ' || text === '○') label = '[CIRCLE]';
    else if (!text) label = '[EMPTY]';
    else label = '[TEXT]';

    console.log(`  body[${i}] <${tag}> ${label} "${text.substring(0, 100)}"`);
  }

  // "성장전략" 섹션 주변
  console.log('\n--- Body children around "성장전략" section ---\n');
  for (let i = 75; i < Math.min(kids.length, 110); i++) {
    const n = kids[i];
    if (n.nodeType !== 1) continue;
    const tag = getLocalName(n);
    const text = getElementText(n).trim();
    const hasTxbx = containsTextbox(n);

    let label = '';
    if (tag === 'tbl') label = '[TABLE]';
    else if (hasTxbx) label = '[TXBX]';
    else if (hasNumPr(n)) label = '[BULLET]';
    else if (text === 'ㅇ' || text === '○') label = '[CIRCLE]';
    else if (!text) label = '[EMPTY]';
    else label = '[TEXT]';

    console.log(`  body[${i}] <${tag}> ${label} "${text.substring(0, 100)}"`);
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
    console.log(`Latest: ${files[0].name} (${new Date(files[0].mtime).toLocaleString()})`);
    await analyze(files[0].path, 'LATEST FILLED');
  }

  // Compare with original
  const origPath = path.join(downloadDir, '[별첨 1] 2025년도 예비창업패키지 사업계획서 양식.docx');
  if (fs.existsSync(origPath)) {
    await analyze(origPath, 'ORIGINAL');
  }
}

main().catch(console.error);
