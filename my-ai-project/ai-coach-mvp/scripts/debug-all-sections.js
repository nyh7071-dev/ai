// Debug: 전체 body 구조 - 모든 섹션의 ㅇ/- 구조 파악
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

function getNumPr(p) {
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
  const kids = body.childNodes || [];

  // ALL body children summary
  console.log('=== FULL BODY STRUCTURE ===\n');
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType !== 1) continue;

    const tag = getLocalName(n);
    const text = getElementText(n).trim();
    const hasTxbx = hasTextbox(n);
    const numPr = tag === 'p' ? getNumPr(n) : null;

    let label = '';
    if (tag === 'tbl') label = '[TABLE]';
    else if (tag === 'sdt') label = '[SDT]';
    else if (hasTxbx) label = '[TEXTBOX]';
    else if (numPr) label = `[BULLET numId=${numPr.numId} ilvl=${numPr.ilvl}]`;
    else if (text === 'ㅇ') label = '[CIRCLE_MARKER]';
    else if (text === '') label = '[EMPTY]';
    else label = `[TEXT]`;

    const textPreview = text ? ` "${text.substring(0, 80)}"` : '';
    console.log(`body[${i}] <${tag}> ${label}${textPreview}`);
  }

  // Detect fillable body sections
  console.log('\n\n=== DETECTED BODY SECTIONS ===\n');
  let sectionIdx = 0;
  let inSection = false;
  let sectionTitle = '';
  let sectionStart = -1;
  let sectionEnd = -1;
  let sectionBodyParagraphs = [];

  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType !== 1) continue;

    const tag = getLocalName(n);
    const text = getElementText(n).trim();
    const hasTxbx = hasTextbox(n);

    // Section title pattern: textbox with "N. title (English)_subtitle"
    if (hasTxbx && /^\d+\.\s/.test(text)) {
      // Close previous section
      if (inSection && sectionBodyParagraphs.length > 0) {
        console.log(`SECTION ${sectionIdx}: "${sectionTitle}"`);
        console.log(`  body range: [${sectionStart}..${sectionEnd}]`);
        console.log(`  body paragraphs: ${sectionBodyParagraphs.length} (ㅇ: ${sectionBodyParagraphs.filter(p => p.text === 'ㅇ').length}, bullets: ${sectionBodyParagraphs.filter(p => p.numPr).length}, empty: ${sectionBodyParagraphs.filter(p => !p.text && !p.numPr).length})`);
        sectionIdx++;
      }

      sectionTitle = text.split('\n')[0].substring(0, 60);
      inSection = true;
      sectionStart = -1;
      sectionEnd = -1;
      sectionBodyParagraphs = [];
      continue;
    }

    // Guide textbox (※ 텍스트) - skip
    if (hasTxbx && text.includes('※')) continue;

    // If we're in a section and this is a regular body paragraph
    if (inSection && tag === 'p' && !hasTxbx) {
      const numPr = getNumPr(n);
      if (sectionStart === -1) sectionStart = i;
      sectionEnd = i;
      sectionBodyParagraphs.push({ idx: i, text, numPr });
    }

    // Section ends when we hit a table or another textbox
    if (inSection && (tag === 'tbl' || (hasTxbx && !text.includes('※')))) {
      if (sectionBodyParagraphs.length > 0) {
        console.log(`SECTION ${sectionIdx}: "${sectionTitle}"`);
        console.log(`  body range: [${sectionStart}..${sectionEnd}]`);
        console.log(`  body paragraphs: ${sectionBodyParagraphs.length} (ㅇ: ${sectionBodyParagraphs.filter(p => p.text === 'ㅇ').length}, bullets: ${sectionBodyParagraphs.filter(p => p.numPr).length}, empty: ${sectionBodyParagraphs.filter(p => !p.text && !p.numPr).length})`);
        sectionIdx++;
      }
      inSection = false;
      sectionBodyParagraphs = [];
    }
  }

  // Final section
  if (inSection && sectionBodyParagraphs.length > 0) {
    console.log(`SECTION ${sectionIdx}: "${sectionTitle}"`);
    console.log(`  body range: [${sectionStart}..${sectionEnd}]`);
    console.log(`  body paragraphs: ${sectionBodyParagraphs.length} (ㅇ: ${sectionBodyParagraphs.filter(p => p.text === 'ㅇ').length}, bullets: ${sectionBodyParagraphs.filter(p => p.numPr).length}, empty: ${sectionBodyParagraphs.filter(p => !p.text && !p.numPr).length})`);
  }
}

main().catch(console.error);
