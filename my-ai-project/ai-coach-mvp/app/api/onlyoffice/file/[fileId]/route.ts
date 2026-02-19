/**
 * GET /api/onlyoffice/file/[fileId]
 *
 * 업로드된 DOCX 파일을 fileId로 서빙
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId } = await params;

    // 안전성 검증: fileId는 UUID 형식이어야 함
    if (!/^[a-f0-9-]+$/i.test(fileId)) {
      return NextResponse.json({ error: 'Invalid fileId' }, { status: 400 });
    }

    const uploadsDir = join(process.cwd(), 'uploads');

    // .docx 확장자로 파일 찾기
    const filePath = join(uploadsDir, `${fileId}.docx`);

    try {
      await stat(filePath);
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const buffer = await readFile(filePath);

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${fileId}.docx"`,
      },
    });
  } catch (error: any) {
    console.error('[onlyoffice/file] 에러:', error);
    return NextResponse.json(
      { error: '파일 서빙 실패', details: error.message },
      { status: 500 }
    );
  }
}
