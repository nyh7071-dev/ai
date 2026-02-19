/**
 * POST /api/docx/fill-ops
 *
 * DOCX 템플릿에 write_ops.json 적용하여 filled.docx 반환
 *
 * Request (multipart/form-data):
 * - template: DOCX 파일 (필수)
 * - ops: JSON 문자열 또는 파일 (필수)
 * - skipEmpty: "1" → 빈 값 ops 건너뜀 (선택)
 * - debug: "1" → JSON 응답 (선택)
 *
 * Response:
 * - 성공: DOCX 파일 (Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document)
 * - 실패: JSON { error, details }
 * - debug=1: JSON { summary, base64Docx }
 *
 * Headers:
 * - X-Fill-Summary: JSON 문자열 (summary)
 *
 * @example
 * curl -F "template=@template.docx" \
 *      -F "ops=@write_ops.json" \
 *      -F "skipEmpty=1" \
 *      http://localhost:3000/api/docx/fill-ops \
 *      --output filled.docx
 */

import { NextRequest, NextResponse } from 'next/server';
import { fillDocx, WriteOp } from '@/lib/docx/fillDocx';

// Node runtime 필수 (JSZip, xmldom 사용)
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  console.log('[Fill Ops] API 호출됨');

  try {
    const formData = await req.formData();

    // 1. template 파일 추출
    const templateFile = formData.get('template') as File | null;
    if (!templateFile) {
      return NextResponse.json(
        { error: 'template 파일이 필요합니다', details: 'Missing template file' },
        { status: 400 }
      );
    }

    console.log(`[Fill Ops] Template: ${templateFile.name} (${templateFile.size} bytes)`);

    // 2. ops JSON 추출
    let opsData: WriteOp[] = [];
    const opsField = formData.get('ops');

    if (!opsField) {
      return NextResponse.json(
        { error: 'ops가 필요합니다', details: 'Missing ops field' },
        { status: 400 }
      );
    }

    try {
      if (typeof opsField === 'string') {
        // JSON 문자열
        opsData = JSON.parse(opsField.replace(/^\uFEFF/, '')); // BOM 제거
      } else {
        // File
        const opsText = await opsField.text();
        opsData = JSON.parse(opsText.replace(/^\uFEFF/, ''));
      }

      if (!Array.isArray(opsData)) {
        throw new Error('ops는 배열이어야 합니다');
      }

      console.log(`[Fill Ops] Ops: ${opsData.length}개`);
    } catch (error: any) {
      return NextResponse.json(
        { error: 'ops JSON 파싱 실패', details: error.message },
        { status: 400 }
      );
    }

    // 3. 옵션 추출
    const skipEmpty = formData.get('skipEmpty') === '1';
    const debug = formData.get('debug') === '1';

    console.log(`[Fill Ops] Options: skipEmpty=${skipEmpty}, debug=${debug}`);

    // 3.5 BODY_SECTION 진단 로그
    const bodySectionOps = opsData.filter(op => op.xmlPath?.startsWith('document:body_section:'));
    console.log(`[Fill Ops] 🔍 BODY_SECTION ops: ${bodySectionOps.length}개`);
    for (const op of bodySectionOps) {
      console.log(`  - xmlPath="${op.xmlPath}", valueLen=${String(op.value || '').length}`);
    }

    // 4. 템플릿을 Buffer로 변환
    const templateArrayBuffer = await templateFile.arrayBuffer();
    const templateBuffer = Buffer.from(templateArrayBuffer);

    // 5. fillDocx 실행
    const result = await fillDocx(templateBuffer, opsData, { skipEmpty });

    console.log('[Fill Ops] Summary:', result.summary);
    console.log(
      `[Fill Ops] 완료: ok=${result.summary.ok}, fail=${result.summary.fail}, ` +
      `badPath=${result.summary.badPath}, noTable=${result.summary.noTable}, ` +
      `noRow=${result.summary.noRow}, noCell=${result.summary.noCell}, ` +
      `topTables=${result.summary.topTables}`
    );

    // 6. 응답 생성
    const summaryJson = JSON.stringify(result.summary);

    if (debug) {
      // Debug 모드: JSON 응답
      return NextResponse.json({
        summary: result.summary,
        base64Docx: result.buffer.toString('base64'),
      });
    } else {
      // 일반 모드: DOCX 파일 다운로드
      // Buffer를 Uint8Array로 변환 (NextResponse 호환)
      const uint8Array = new Uint8Array(result.buffer);
      return new NextResponse(uint8Array, {
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': 'attachment; filename="filled.docx"',
          'X-Fill-Summary': summaryJson,
        },
      });
    }
  } catch (error: any) {
    console.error('[Fill Ops] 에러:', error);
    return NextResponse.json(
      {
        error: '서버 에러',
        details: error.message || 'Unknown error',
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
