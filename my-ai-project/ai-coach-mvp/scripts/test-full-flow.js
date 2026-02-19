// Full flow test: scanner detection + fill simulation
const JSZip = require('jszip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
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

function getCellText(tc) { return getElementText(tc); }

function getFirstDirectChild(parent, tagName) {
  const kids = parent.childNodes || [];
  for (let i = 0; i < kids.length; i++) {
    if (kids[i].nodeType === 1 && kids[i].tagName === tagName) return kids[i];
  }
  return null;
}

// Simulate scanBodySections (matching the TypeScript code)
function scanBodySections(dom) {
  const sections = [];
  const body = dom.getElementsByTagName('w:body')[0];
  if (!body) return sections;

  const kids = body.childNodes || [];
  let currentSection = null;

  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType !== 1) continue;

    const tag = getLocalName(n);
    const text = getElementText(n).trim();
    const hasTxbx = containsTextbox(n);

    if (hasTxbx && /^\d+\.\s/.test(text)) {
      if (currentSection && currentSection.contentStart > 0 &&
          (currentSection.circleCount > 0 || currentSection.bulletCount > 0)) {
        sections.push(currentSection);
      }
      const halfLen = Math.floor(text.length / 2);
      const cleanTitle = text.substring(0, halfLen) || text;
      currentSection = {
        titleIndex: i, titleText: cleanTitle.substring(0, 80),
        guideIndex: -1, contentStart: -1, contentEnd: -1,
        circleCount: 0, bulletCount: 0,
      };
      continue;
    }

    if (currentSection && hasTxbx && text.includes('※')) {
      currentSection.guideIndex = i;
      continue;
    }

    if (currentSection && tag === 'p' && !hasTxbx) {
      const isCircle = text === 'ㅇ' || text === '○';
      const isEmpty = !text || text.length === 0;
      const isBullet = hasNumPr(n);
      const isGuideText = text.startsWith('※');

      if (isCircle || isEmpty || isBullet || isGuideText) {
        if (currentSection.contentStart === -1) currentSection.contentStart = i;
        currentSection.contentEnd = i;
        if (isCircle) currentSection.circleCount++;
        if (isBullet) currentSection.bulletCount++;
        continue;
      }
    }

    if (currentSection && (tag === 'tbl' || (hasTxbx && !text.includes('※')) ||
        (tag === 'p' && !hasTxbx && text.length > 0 && text !== 'ㅇ' && text !== '○' && !text.startsWith('※')))) {
      if (currentSection.contentStart > 0 &&
          (currentSection.circleCount > 0 || currentSection.bulletCount > 0)) {
        sections.push(currentSection);
      }
      currentSection = null;
    }
  }

  if (currentSection && currentSection.contentStart > 0 &&
      (currentSection.circleCount > 0 || currentSection.bulletCount > 0)) {
    sections.push(currentSection);
  }

  return sections;
}

// Simulate fillBodySection
function fillBodySection(dom, titleSignature, value) {
  const body = dom.getElementsByTagName('w:body')[0];
  if (!body) return false;

  const kids = body.childNodes || [];
  let titleIndex = -1;

  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType !== 1) continue;
    if (!containsTextbox(n)) continue;
    const text = getCellText(n).trim();
    const fullSig = text.substring(0, 60).replace(/[^가-힣a-zA-Z0-9]/g, '').substring(0, 30);
    const halfText = text.substring(0, Math.floor(text.length / 2));
    const halfSig = halfText.substring(0, 60).replace(/[^가-힣a-zA-Z0-9]/g, '').substring(0, 30);
    if (fullSig === titleSignature || halfSig === titleSignature) {
      titleIndex = i;
      break;
    }
  }

  if (titleIndex === -1) return false;

  const toRemove = [];
  for (let i = titleIndex + 1; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType !== 1) continue;
    const tag = getLocalName(n);
    const text = getCellText(n).trim();
    const hasTxbx = containsTextbox(n);

    if (hasTxbx) {
      if (text.includes('※')) continue;
      break;
    }
    if (tag === 'tbl') break;
    if (tag === 'p') {
      const isCircle = text === 'ㅇ' || text === '○';
      const isEmpty = !text || text.length === 0;
      const isBullet = hasNumPr(n);
      const isGuideText = text.startsWith('※');
      if (isCircle || isEmpty || isBullet || isGuideText) {
        toRemove.push(n);
      } else {
        break;
      }
    }
  }

  if (toRemove.length === 0) return false;

  const insertBefore = toRemove[toRemove.length - 1].nextSibling;
  for (const node of toRemove) body.removeChild(node);

  const lines = value.split(/\r?\n/).filter(line => line.trim().length > 0);
  for (const line of lines) {
    const p = dom.createElement('w:p');
    const r = dom.createElement('w:r');
    const t = dom.createElement('w:t');
    t.setAttribute('xml:space', 'preserve');
    t.appendChild(dom.createTextNode(line));
    r.appendChild(t);
    p.appendChild(r);
    if (insertBefore) body.insertBefore(p, insertBefore);
    else body.appendChild(p);
  }

  return true;
}

async function main() {
  const filePath = path.join('C:\\Users\\nyh7071\\Downloads', '[별첨 1] 2025년도 예비창업패키지 사업계획서 양식.docx');
  const buf = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('text');
  const dom = new DOMParser().parseFromString(xml, 'text/xml');

  // 1. Scanner - detect body sections
  console.log('=== 1. Body Section Detection ===\n');
  const sections = scanBodySections(dom);

  for (const s of sections) {
    const titleSig = s.titleText.substring(0, 60).replace(/[^가-힣a-zA-Z0-9]/g, '').substring(0, 30);
    console.log(`✅ SECTION: "${s.titleText.substring(0, 60)}"`);
    console.log(`   sig: "${titleSig}"`);
    console.log(`   body[${s.contentStart}..${s.contentEnd}], ㅇ:${s.circleCount}, bullets:${s.bulletCount}`);
  }

  console.log(`\nTotal body sections: ${sections.length}\n`);

  // 2. Fill simulation - replace body sections with test content
  console.log('=== 2. Fill Body Sections ===\n');

  const testContent = {
    "1문제인식Problem창업아이템의필요성": "ㅇ 독거노인 돌봄 서비스 시장 현황\n  - 전국 독거노인 수 약 166만 명으로 매년 증가 추세\n  - 기존 돌봄 서비스의 방문 주기가 길고 IT 기반 모니터링 부재\nㅇ 기존 서비스의 문제점\n  - 방문 요양 서비스의 품질 편차가 크고, 긴급 상황 대응이 느림\n  - 독거노인의 사회적 고립감 해소를 위한 종합적 돌봄 서비스 부족\nㅇ 개발 아이템의 필요성\n  - AI 기반 실시간 건강 모니터링과 사회적 연결 서비스로 돌봄 사각지대 해소",
    "2실현가능성Solution창업아이템의개발계획": "ㅇ 개발 계획\n  - AI 모니터링 시스템 개발 (2025년 상반기)\n  - 사용자 앱 및 관리자 대시보드 구축\n  - 파일럿 테스트 및 서비스 안정화",
    "3성장전략Scaleup사업화추진전략": "ㅇ 시장 진입 전략\n  - 지자체 복지관 연계를 통한 B2G 시장 선점\n  - 독거노인 밀집 지역 우선 서비스 론칭\nㅇ 비즈니스 모델\n  - 월정액 구독형 서비스 (개인/기관 이용료)\n  - 지자체 위탁 운영 수익",
    "4팀구성Team대표자및팀원구성계획": "ㅇ 대표자 역량\n  - 사회복지학 석사, 돌봄 서비스 기획 경력 5년\n  - AI/IoT 기반 헬스케어 프로젝트 수행 경험",
  };

  for (const s of sections) {
    const titleSig = s.titleText.substring(0, 60).replace(/[^가-힣a-zA-Z0-9]/g, '').substring(0, 30);
    const content = testContent[titleSig] || "테스트 내용입니다.";
    const result = fillBodySection(dom, titleSig, content);
    console.log(`${result ? '✅' : '❌'} Fill "${s.titleText.substring(0, 40)}": ${result ? 'SUCCESS' : 'FAILED'}`);
  }

  // 3. Verify - check body structure after filling
  console.log('\n=== 3. Verification ===\n');
  const body = dom.getElementsByTagName('w:body')[0];
  const kids = body.childNodes || [];
  let found = false;
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType !== 1) continue;
    const text = getElementText(n).trim();
    if (text.includes('독거노인') || text.includes('AI 모니터링') || text.includes('시장 진입')) {
      console.log(`body[${i}]: "${text.substring(0, 100)}"`);
      found = true;
    }
  }
  if (!found) {
    console.log('❌ No filled content found in body!');
  } else {
    console.log('\n✅ Body sections filled successfully!');
  }
}

main().catch(console.error);
