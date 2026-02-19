/**
 * POST /api/docs/analyze
 *
 * DOCX 파일을 업로드하면 universalSlotScanner로 채울 슬롯을 자동 탐지
 *
 * Request (multipart/form-data):
 * - file: DOCX 파일 (필수)
 *
 * Response:
 * - { slots: UniversalSlot[], debug: { adapterUsed: string[], stats: object } }
 */

import { NextRequest, NextResponse } from 'next/server';
import { scanUniversalSlots } from '@/lib/docx/universalSlotScanner';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  console.log('[docs/analyze] API 호출됨');

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'file이 필요합니다' },
        { status: 400 }
      );
    }

    console.log(`[docs/analyze] File: ${file.name} (${file.size} bytes)`);

    // DOCX를 Buffer로 변환
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // universalSlotScanner로 슬롯 탐지
    const result = await scanUniversalSlots(buffer);

    console.log(`[docs/analyze] 스캔 완료: ${result.slots.length}개 슬롯`);
    console.log(`[docs/analyze] Stats:`, result.stats);

    return NextResponse.json({
      slots: result.slots,
      debug: {
        adapterUsed: ['universalSlotScanner'],
        stats: result.stats,
      },
    });
  } catch (error: any) {
    console.error('[docs/analyze] 에러:', error);
    return NextResponse.json(
      {
        error: '분석 실패',
        details: error.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}
