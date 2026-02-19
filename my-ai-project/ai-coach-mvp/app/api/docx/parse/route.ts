// POST /api/docx/parse
// DOCX 파일을 파싱하여 IR과 Slot Schema 반환

import { NextRequest, NextResponse } from 'next/server';
import { docxParser, slotExtractor } from '@/lib/document-ir';

export async function POST(req: NextRequest) {
  console.log('[DOCX Parse] API 호출됨');

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: '파일이 없습니다' }, { status: 400 });
    }

    console.log(`[DOCX Parse] 파일: ${file.name}, 크기: ${file.size} bytes`);

    const buffer = Buffer.from(await file.arrayBuffer());

    // 1. DOCX → IR 파싱
    console.log('[DOCX Parse] IR 파싱 시작...');
    const ir = await docxParser.parse(buffer);
    console.log(`[DOCX Parse] IR 파싱 완료: ${ir.blocks.length}개 블록, ${ir.anchors.length}개 앵커`);

    // 2. Slot Schema 추출
    console.log('[DOCX Parse] Slot Schema 추출 시작...');
    const schema = slotExtractor.extract(ir);
    console.log(`[DOCX Parse] Slot Schema 추출 완료: ${schema.slots.length}개 슬롯`);

    // 슬롯 정보 로깅
    for (const slot of schema.slots) {
      console.log(`  - ${slot.slot_id}: "${slot.label}" (${slot.slot_type})`);
    }

    return NextResponse.json({
      success: true,
      ir: {
        doc_id: ir.doc_id,
        format: ir.format,
        blockCount: ir.blocks.length,
        anchorCount: ir.anchors.length,
        // 디버깅용: 테이블 요약
        tables: ir.blocks
          .filter(b => b.type === 'table')
          .map(t => ({
            id: t.id,
            rows: (t as any).rows.length,
            cols: (t as any).columnCount,
          })),
      },
      schema,
    });
  } catch (error: any) {
    console.error('[DOCX Parse] 에러:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
