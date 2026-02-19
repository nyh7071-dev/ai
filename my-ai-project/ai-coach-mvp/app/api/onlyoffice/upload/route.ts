/**
 * POST /api/onlyoffice/upload
 *
 * DOCX 파일을 업로드하고 OnlyOffice에서 편집 가능한 fileId 반환
 *
 * Request (multipart/form-data):
 * - file: DOCX 파일 (필수)
 *
 * Response:
 * - { fileId: string, fileName: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'file이 필요합니다' },
        { status: 400 }
      );
    }

    // 안전한 파일명 생성
    const fileId = randomUUID();
    const ext = file.name.split('.').pop() || 'docx';
    const safeFileName = `${fileId}.${ext}`;
    const originalName = basename(file.name);

    // uploads 디렉토리 확인/생성
    const uploadsDir = join(process.cwd(), 'uploads');
    await mkdir(uploadsDir, { recursive: true });

    // 파일 저장
    const arrayBuffer = await file.arrayBuffer();
    const filePath = join(uploadsDir, safeFileName);
    await writeFile(filePath, Buffer.from(arrayBuffer));

    console.log(`[onlyoffice/upload] File saved: ${safeFileName} (${file.size} bytes, original: ${originalName})`);

    return NextResponse.json({
      fileId,
      fileName: originalName,
      url: `/api/onlyoffice/file/${fileId}`,
    });
  } catch (error: any) {
    console.error('[onlyoffice/upload] 에러:', error);
    return NextResponse.json(
      { error: '업로드 실패', details: error.message },
      { status: 500 }
    );
  }
}
