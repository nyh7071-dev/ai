/**
 * POST /api/docx/analyze-slots
 *
 * DOCX 템플릿 분석 → slots 추출
 *
 * Request (multipart/form-data):
 * - file: DOCX 파일
 *
 * Response:
 * {
 *   "slots": [
 *     { "key": "startup_item_name", "label": "창업아이템명", "xmlPath": "...", "type": "..." }
 *   ],
 *   "writeOps": [
 *     { "xmlPath": "...", "key": "...", "slot": "...", "value": "" }
 *   ]
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { analyzeDocxSlots } from '@/lib/docx/analyzeSlots';

export const runtime = 'nodejs';

// CORS 헤더
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// OPTIONS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}

export async function POST(req: NextRequest) {
  console.log('[analyze-slots] API 호출됨');

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: '파일이 없습니다' },
        { status: 400, headers: corsHeaders }
      );
    }

    console.log(`[analyze-slots] 파일: ${file.name}, 크기: ${file.size} bytes`);

    const buffer = Buffer.from(await file.arrayBuffer());

    // 슬롯 추출
    const slots = await analyzeDocxSlots(buffer);

    // write_ops 형식으로 변환
    const writeOps = slots.map(slot => ({
      xmlPath: slot.xmlPath,
      key: slot.key,
      slot: slot.key, // slot 필드도 key로 설정
      value: '', // 빈 값 (템플릿이므로)
    }));

    console.log(`[analyze-slots] 추출 완료: ${slots.length}개 슬롯`);

    return NextResponse.json(
      {
        success: true,
        slots,
        writeOps,
        count: slots.length,
      },
      { headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('[analyze-slots] 에러:', error);
    return NextResponse.json(
      {
        error: '슬롯 추출 실패',
        details: error.message,
      },
      { status: 500, headers: corsHeaders }
    );
  }
}
