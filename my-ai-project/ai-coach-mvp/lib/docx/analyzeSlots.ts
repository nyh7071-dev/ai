/**
 * lib/docx/analyzeSlots.ts
 *
 * DOCX 템플릿 분석: placeholder, Content Control, 표 라벨 탐지
 */

import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';

export interface Slot {
  key: string;
  label: string;
  xmlPath: string;
  type: 'placeholder' | 'content-control' | 'table-label';
}

/**
 * DOCX 파일을 분석하여 슬롯 추출
 *
 * 우선순위:
 * 1. {{key}} placeholder
 * 2. Content Control (w:sdt) tag
 * 3. Table label matching
 */
export async function analyzeDocxSlots(buffer: Buffer): Promise<Slot[]> {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml')?.async('text');

  if (!documentXml) {
    throw new Error('document.xml not found in DOCX');
  }

  const dom = new DOMParser().parseFromString(documentXml, 'text/xml');
  const slots: Slot[] = [];
  const seenKeys = new Set<string>();

  // 1. Placeholder {{key}} 탐지
  console.log('[analyzeSlots] 1단계: Placeholder 탐지');
  const textNodes = dom.getElementsByTagName('w:t');
  for (let i = 0; i < textNodes.length; i++) {
    const text = textNodes[i].textContent || '';
    const matches = text.matchAll(/\{\{(\w+)\}\}/g);
    for (const match of matches) {
      const key = match[1];
      if (seenKeys.has(key)) continue;

      seenKeys.add(key);
      slots.push({
        key,
        label: key,
        xmlPath: `placeholder:${key}`,
        type: 'placeholder',
      });
      console.log(`  - 발견: {{${key}}}`);
    }
  }

  // 2. Content Control tag 탐지
  console.log('[analyzeSlots] 2단계: Content Control 탐지');
  const sdts = dom.getElementsByTagName('w:sdt');
  for (let i = 0; i < sdts.length; i++) {
    const sdt = sdts[i];
    const tags = sdt.getElementsByTagName('w:tag');
    if (tags.length > 0) {
      const tag = tags[0].getAttribute('w:val') || '';
      if (tag && !seenKeys.has(tag)) {
        seenKeys.add(tag);
        slots.push({
          key: tag,
          label: tag,
          xmlPath: `sdt:${tag}`,
          type: 'content-control',
        });
        console.log(`  - 발견: <w:sdt tag="${tag}">`);
      }
    }
  }

  // 3. Table label matching (fallback)
  console.log('[analyzeSlots] 3단계: Table label 매칭');
  const tables = getTopLevelTables(dom);
  console.log(`  - 최상위 테이블 ${tables.length}개 발견`);

  // 라벨 매칭 규칙 (더 유연하게: 부분 매칭 지원)
  const labelMappings: Array<{
    patterns: string[];
    key: string;
    labelDisplay: string;
  }> = [
    {
      patterns: ['창업아이템명', '아이템명', 'item name', 'startup item'],
      key: 'startup_item_name',
      labelDisplay: '창업아이템명',
    },
    {
      patterns: ['문제 인식', 'problem', '문제인식'],
      key: 'problem',
      labelDisplay: '문제 인식',
    },
    {
      patterns: ['해결 방안', 'solution', '실현 가능성', '해결방안'],
      key: 'solution',
      labelDisplay: '해결 방안',
    },
    {
      patterns: ['성장전략', 'scale-up', 'scaleup', '성장 전략'],
      key: 'scale_up',
      labelDisplay: '성장전략',
    },
    {
      patterns: ['팀 구성', 'team', '팀구성'],
      key: 'team',
      labelDisplay: '팀 구성',
    },
    {
      patterns: ['산출물', 'deliverable', '결과물'],
      key: 'deliverable',
      labelDisplay: '산출물',
    },
  ];

  tables.forEach((table, tableIndex) => {
    const rows = table.getElementsByTagName('w:tr');
    console.log(`  - 테이블 #${tableIndex + 1}: ${rows.length}개 행`);

    for (let r = 0; r < rows.length; r++) {
      const cells = rows[r].getElementsByTagName('w:tc');
      if (cells.length >= 2) {
        const labelCell = cells[0];
        const labelText = getCellText(labelCell).trim().toLowerCase();

        if (!labelText) continue; // 빈 셀 스킵

        // 패턴 매칭
        for (const mapping of labelMappings) {
          const matched = mapping.patterns.some(pattern =>
            labelText.includes(pattern.toLowerCase())
          );

          if (matched && !seenKeys.has(mapping.key)) {
            seenKeys.add(mapping.key);

            // xmlPath: document:table{n}:r{row}:c{col}
            // table은 1-based (실제 테이블 번호 사용), row/col은 0-based
            const xmlPath = `document:table${tableIndex + 1}:r${r}:c1`;

            slots.push({
              key: mapping.key,
              label: mapping.labelDisplay,
              xmlPath,
              type: 'table-label',
            });
            console.log(
              `  - 매칭 성공: "${getCellText(labelCell).trim()}" → ${mapping.key} (${xmlPath})`
            );
            break; // 첫 번째 매칭만 사용
          }
        }
      }
    }
  });

  console.log(`[analyzeSlots] 총 ${slots.length}개 슬롯 추출 완료`);

  // 4. Fallback: 슬롯이 0개면 빈 셀 탐지 시도
  if (slots.length === 0) {
    console.log('[analyzeSlots] 4단계: Fallback - 빈 셀 탐지');

    tables.forEach((table, tableIndex) => {
      const rows = table.getElementsByTagName('w:tr');

      for (let r = 0; r < rows.length; r++) {
        const cells = rows[r].getElementsByTagName('w:tc');

        for (let c = 0; c < cells.length; c++) {
          const cellText = getCellText(cells[c]).trim();

          // 빈 셀 또는 placeholder 패턴 찾기
          const isEmpty = !cellText || cellText.length < 3;
          const isPlaceholder = /^(_+|\.{3,}|OOO|XXX|\[.*\]|\(.*\))$/.test(cellText);

          if (isEmpty || isPlaceholder) {
            const key = `slot_t${tableIndex + 1}_r${r}_c${c}`;

            if (!seenKeys.has(key)) {
              seenKeys.add(key);

              const xmlPath = `document:table${tableIndex + 1}:r${r}:c${c}`;

              slots.push({
                key,
                label: `T${tableIndex + 1}R${r}C${c}`,
                xmlPath,
                type: 'table-label',
              });

              console.log(`  - 빈 셀 발견: ${xmlPath} → ${key}`);
            }
          }
        }
      }
    });

    console.log(`[analyzeSlots] Fallback 완료: ${slots.length}개 슬롯 추가`);
  }

  return slots;
}

/**
 * 최상위 테이블만 추출 (중첩 테이블 제외)
 */
function getTopLevelTables(dom: any): any[] {
  const body = dom.getElementsByTagName('w:body')[0];
  const tables: any[] = [];
  if (!body) return tables;

  for (let i = 0; i < body.childNodes.length; i++) {
    const node = body.childNodes[i];
    if (node.tagName === 'w:tbl') {
      tables.push(node);
    }
  }

  return tables;
}

/**
 * 셀의 텍스트 추출
 */
function getCellText(tc: any): string {
  const texts: string[] = [];
  const tNodes = tc.getElementsByTagName('w:t');
  for (let i = 0; i < tNodes.length; i++) {
    texts.push(tNodes[i].textContent || '');
  }
  return texts.join('');
}
