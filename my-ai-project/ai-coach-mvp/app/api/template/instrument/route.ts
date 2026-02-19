// POST /api/template/instrument
// SlotSchema의 slot 위치에 Content Control(SDT) 삽입

import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';

interface Slot {
  slot_id: string;
  label: string;
  slot_type?: string;
  selector: {
    strategy: string;
    path: {
      block_id?: string;
      row?: number;
      cell?: number;
      xmlStart?: number;
      xmlEnd?: number;
    };
  };
}

interface InstrumentRequest {
  docxBase64: string;
  slots: Slot[];
}

export async function POST(req: NextRequest) {
  console.log('[Instrument] API 호출됨');

  try {
    const body: InstrumentRequest = await req.json();
    const { docxBase64, slots } = body;

    if (!docxBase64 || !slots) {
      return NextResponse.json(
        { error: 'docxBase64와 slots가 필요합니다' },
        { status: 400 }
      );
    }

    // Base64 디코드
    const buffer = Buffer.from(docxBase64, 'base64');
    const zip = await JSZip.loadAsync(buffer);
    let xml = await zip.file('word/document.xml')?.async('string');

    if (!xml) {
      return NextResponse.json(
        { error: 'document.xml을 찾을 수 없습니다' },
        { status: 400 }
      );
    }

    // table_cell 전략 슬롯만 필터링
    const tableCellSlots = slots.filter(
      (s) => s.selector.strategy === 'table_cell' && s.selector.path.xmlStart !== undefined
    );

    console.log(`[Instrument] 처리할 table_cell 슬롯: ${tableCellSlots.length}개`);

    // xmlStart 내림차순 정렬 (뒤에서부터 처리)
    const sortedSlots = [...tableCellSlots].sort((a, b) => {
      const aStart = a.selector.path.xmlStart || 0;
      const bStart = b.selector.path.xmlStart || 0;
      return bStart - aStart;
    });

    // 이미 삽입된 태그 추적
    const existingTags = extractExistingTags(xml);
    console.log(`[Instrument] 기존 태그: ${existingTags.size}개`);

    let insertedCount = 0;
    let skippedCount = 0;

    for (const slot of sortedSlots) {
      const { slot_id, label, selector } = slot;
      const { xmlStart, xmlEnd } = selector.path;

      // 중복 태그 체크
      if (existingTags.has(slot_id)) {
        console.log(`[Instrument] 스킵 (중복): ${slot_id}`);
        skippedCount++;
        continue;
      }

      if (xmlStart === undefined || xmlEnd === undefined) {
        console.log(`[Instrument] 스킵 (위치 없음): ${slot_id}`);
        skippedCount++;
        continue;
      }

      // <w:tc> 범위 추출
      const cellXml = xml.substring(xmlStart, xmlEnd);

      // <w:tc>로 시작하는지 확인
      if (!cellXml.startsWith('<w:tc')) {
        console.log(`[Instrument] 경고: ${slot_id} 위치가 <w:tc>가 아님`);
        skippedCount++;
        continue;
      }

      // Content Control 삽입
      const instrumentedCell = insertContentControl(cellXml, slot_id, label);

      // XML 교체 (뒤에서부터 처리하므로 offset 안정적)
      xml = xml.substring(0, xmlStart) + instrumentedCell + xml.substring(xmlEnd);

      insertedCount++;
      console.log(`[Instrument] ✓ 삽입: ${slot_id} (${label})`);
    }

    console.log(`[Instrument] 완료: 삽입=${insertedCount}, 스킵=${skippedCount}`);

    // ===== [검증 1] SDT 및 태그 개수 확인 =====
    const sdtCount = (xml.match(/<w:sdt/g) || []).length;
    const tagCount = (xml.match(/<w:tag w:val="/g) || []).length;
    console.log('\n[Instrument 검증 1] SDT/Tag 개수');
    console.log(`  - <w:sdt> 개수: ${sdtCount}`);
    console.log(`  - <w:tag w:val="> 개수: ${tagCount}`);

    // ===== [검증 2] 샘플 slot_id 존재 확인 =====
    const sampleSlotIds = ['s_000001', 's_000002', 's_000003'];
    console.log('\n[Instrument 검증 2] 샘플 slot_id 존재 여부');
    sampleSlotIds.forEach(slotId => {
      const exists = xml.includes(`w:val="${slotId}"`);
      console.log(`  - ${slotId}: ${exists ? '✓ 존재' : '✗ 없음'}`);
    });

    // ===== [검증 3] xmlStart/xmlEnd 절대/상대 위치 판정 =====
    if (sortedSlots.length > 0 && sortedSlots[0].selector.path.xmlStart !== undefined) {
      const firstSlot = sortedSlots[sortedSlots.length - 1]; // 가장 앞쪽 슬롯
      const xmlStart = firstSlot.selector.path.xmlStart!;

      // body 위치 찾기
      const bodyMatch = xml.match(/<w:body[^>]*>/);
      const bodyStartPos = bodyMatch ? bodyMatch.index! + bodyMatch[0].length : 0;

      // xmlStart가 절대 위치인지 확인
      const probeFromXmlStart = xml.slice(xmlStart, xmlStart + 20);
      const probeFromBodyRelative = xml.slice(bodyStartPos + xmlStart, bodyStartPos + xmlStart + 20);

      console.log('\n[Instrument 검증 3] xmlStart 위치 판정');
      console.log(`  - 첫 슬롯: ${firstSlot.slot_id} (${firstSlot.label})`);
      console.log(`  - xmlStart: ${xmlStart}`);
      console.log(`  - body 시작 위치: ${bodyStartPos}`);
      console.log(`  - probe(절대): "${probeFromXmlStart}"`);
      console.log(`  - probe(body 상대): "${probeFromBodyRelative}"`);

      const isAbsoluteStartsWithTc = probeFromXmlStart.startsWith('<w:tc');
      const isRelativeStartsWithTc = probeFromBodyRelative.startsWith('<w:tc');

      console.log(`  - 절대 위치가 <w:tc>로 시작: ${isAbsoluteStartsWithTc}`);
      console.log(`  - body 상대 위치가 <w:tc>로 시작: ${isRelativeStartsWithTc}`);
      console.log(`  - ✓ xmlStart_is_absolute=${isAbsoluteStartsWithTc}`);
    } else {
      console.log('\n[Instrument 검증 3] xmlStart 위치 판정 - 스킵 (슬롯 없음)');
    }

    console.log('\n[Instrument] 검증 완료\n');

    // 수정된 document.xml 저장
    zip.file('word/document.xml', xml);
    const instrumentedBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    // Buffer를 Uint8Array로 변환하여 반환 (NextResponse 호환)
    const uint8Array = new Uint8Array(instrumentedBuffer);
    return new NextResponse(uint8Array, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': 'attachment; filename="instrumented.docx"',
        'X-Inserted-Count': insertedCount.toString(),
        'X-Skipped-Count': skippedCount.toString(),
        'X-SDT-Count': sdtCount.toString(),
        'X-Tag-Count': tagCount.toString(),
      },
    });
  } catch (error: any) {
    console.error('[Instrument] 에러:', error);
    return NextResponse.json(
      { error: error.message || '계측 실패' },
      { status: 500 }
    );
  }
}

/**
 * 기존 XML에서 이미 존재하는 Content Control 태그 추출
 */
function extractExistingTags(xml: string): Set<string> {
  const tags = new Set<string>();
  const tagRegex = /<w:tag\s+w:val="([^"]+)"/g;
  let match;

  while ((match = tagRegex.exec(xml)) !== null) {
    tags.add(match[1]);
  }

  return tags;
}

/**
 * <w:tc> 내부에 Content Control(SDT) 삽입
 */
function insertContentControl(cellXml: string, slotId: string, label: string): string {
  // <w:tc> 시작 태그 찾기
  const tcStartMatch = cellXml.match(/^<w:tc[^>]*>/);
  if (!tcStartMatch) return cellXml;

  const tcStartTag = tcStartMatch[0];
  const tcStartEnd = tcStartTag.length;

  // <w:tcPr> 추출 (있으면)
  let tcPrEnd = tcStartEnd;
  const tcPrMatch = cellXml.substring(tcStartEnd).match(/^(<w:tcPr[\s\S]*?<\/w:tcPr>)/);
  if (tcPrMatch) {
    tcPrEnd = tcStartEnd + tcPrMatch[0].length;
  }

  // </w:tc> 찾기
  const tcEndPos = cellXml.lastIndexOf('</w:tc>');
  if (tcEndPos === -1) return cellXml;

  // <w:tc> ~ <w:tcPr> 사이 + 내용 + </w:tc>
  const tcPrefix = cellXml.substring(0, tcPrEnd); // <w:tc...> + <w:tcPr>...</w:tcPr>
  const cellContent = cellXml.substring(tcPrEnd, tcEndPos); // 실제 내용 (<w:p> 등)
  const tcSuffix = cellXml.substring(tcEndPos); // </w:tc>

  // SDT 구조 생성
  const sdt = createSdtXml(slotId, label, cellContent);

  return tcPrefix + sdt + tcSuffix;
}

/**
 * Content Control(SDT) XML 생성
 */
function createSdtXml(slotId: string, label: string, content: string): string {
  const escapedLabel = escapeXml(label);

  return `<w:sdt>
  <w:sdtPr>
    <w:tag w:val="${escapeXml(slotId)}"/>
    <w:alias w:val="${escapedLabel}"/>
    <w:id w:val="${generateSdtId()}"/>
  </w:sdtPr>
  <w:sdtContent>${content}</w:sdtContent>
</w:sdt>`;
}

/**
 * XML 특수문자 이스케이프
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Content Control ID 생성 (랜덤 8자리 숫자)
 */
function generateSdtId(): string {
  return Math.floor(10000000 + Math.random() * 90000000).toString();
}
