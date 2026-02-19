// POST /api/docx/fill-v2
// IR 기반 DOCX 자동 채우기 (새로운 아키텍처)

import { NextRequest, NextResponse } from 'next/server';
import { docxParser, slotExtractor, docxWriter, SlotSchema, FillResult, SlotFill } from '@/lib/document-ir';

export async function POST(req: NextRequest) {
  console.log('[DOCX Fill V2] API 호출됨');

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const filledFieldsStr = formData.get('filledFields') as string;
    const schemaStr = formData.get('schema') as string; // 선택적: 미리 추출된 스키마

    if (!file) {
      return NextResponse.json({ error: '파일이 없습니다' }, { status: 400 });
    }
    if (!filledFieldsStr) {
      return NextResponse.json({ error: 'filledFields가 없습니다' }, { status: 400 });
    }

    const filledFields = JSON.parse(filledFieldsStr);
    console.log(`[DOCX Fill V2] 채울 필드 수: ${filledFields.length}`);

    const buffer = Buffer.from(await file.arrayBuffer());

    // 1. DOCX → IR 파싱
    console.log('[DOCX Fill V2] IR 파싱...');
    const ir = await docxParser.parse(buffer);
    console.log(`[DOCX Fill V2] ${ir.blocks.length}개 블록 파싱됨`);

    // 2. Slot Schema (캐시 사용 또는 새로 추출)
    let schema: SlotSchema;
    if (schemaStr) {
      schema = JSON.parse(schemaStr);
      console.log('[DOCX Fill V2] 캐시된 스키마 사용');
    } else {
      schema = slotExtractor.extract(ir);
      console.log(`[DOCX Fill V2] ${schema.slots.length}개 슬롯 추출됨`);
    }

    // 3. filledFields를 FillResult로 매핑
    const fills = mapFieldsToFills(filledFields, schema);
    console.log(`[DOCX Fill V2] ${fills.fills.length}개 필드 매핑됨`);

    // 4. DOCX에 패치 적용
    console.log('[DOCX Fill V2] 패치 적용...');
    const filledBuffer = await docxWriter.applyFills(buffer, ir, schema, fills);
    console.log('[DOCX Fill V2] 완료!');

    return new NextResponse(new Uint8Array(filledBuffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="filled_${Date.now()}.docx"`,
      },
    });
  } catch (error: any) {
    console.error('[DOCX Fill V2] 에러:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// filledFields (label/value 배열)를 FillResult로 매핑
function mapFieldsToFills(
  filledFields: Array<{ label: string; value: string }>,
  schema: SlotSchema
): FillResult {
  const fills: SlotFill[] = [];

  for (const field of filledFields) {
    // 라벨로 슬롯 찾기
    const slot = findSlotByLabel(field.label, schema);

    if (slot) {
      fills.push({
        slot_id: slot.slot_id,
        value: field.value,
        confidence: 1.0,
        reason: `Matched by label: ${field.label}`,
      });
      console.log(`[DOCX Fill V2] 매핑 성공: "${field.label}" → ${slot.slot_id}`);
    } else {
      console.log(`[DOCX Fill V2] 매핑 실패: "${field.label}" - 슬롯을 찾지 못함`);
    }
  }

  return {
    fills,
    questions: [],
  };
}

// 라벨로 슬롯 찾기 (유사 매칭 포함)
function findSlotByLabel(label: string, schema: SlotSchema) {
  const normalizedLabel = normalizeLabel(label);

  // 1. 정확히 일치
  let slot = schema.slots.find(s => normalizeLabel(s.label) === normalizedLabel);
  if (slot) return slot;

  // 2. 포함 관계
  slot = schema.slots.find(s =>
    normalizedLabel.includes(normalizeLabel(s.label)) ||
    normalizeLabel(s.label).includes(normalizedLabel)
  );
  if (slot) return slot;

  // 3. 핵심 키워드 매칭
  const keywords = normalizedLabel.split(/[\s()]+/).filter(w => w.length >= 2);
  for (const keyword of keywords) {
    slot = schema.slots.find(s => normalizeLabel(s.label).includes(keyword));
    if (slot) return slot;
  }

  // 4. nearby_text에서 찾기
  slot = schema.slots.find(s =>
    s.context?.nearby_text?.some(t =>
      normalizeLabel(t).includes(normalizedLabel) ||
      normalizedLabel.includes(normalizeLabel(t))
    )
  );
  if (slot) return slot;

  return null;
}

function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()[\]{}:：]/g, '')
    .replace(/problem|solution|team|scale-?up/gi, match => {
      switch (match.toLowerCase()) {
        case 'problem': return '문제인식';
        case 'solution': return '실현가능성';
        case 'team': return '팀구성';
        case 'scale-up':
        case 'scaleup': return '성장전략';
        default: return match;
      }
    });
}
