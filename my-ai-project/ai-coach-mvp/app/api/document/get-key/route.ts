/**
 * POST /api/document/get-key
 *
 * 문서 식별자(URL/파일명/docId 등)를 받아서 stable document key 생성
 *
 * Request:
 * {
 *   "identifier": "문서 URL 또는 파일명 또는 기타 식별자"
 * }
 *
 * Response:
 * {
 *   "documentKey": "stable-hash-based-key",
 *   "identifier": "원본 식별자"
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// CORS 헤더
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
  try {
    const body = await req.json();
    const { identifier } = body;

    if (!identifier || typeof identifier !== 'string') {
      return NextResponse.json(
        { error: 'identifier is required and must be a string' },
        { status: 400, headers: corsHeaders }
      );
    }

    // SHA256 해시로 stable key 생성
    const hash = crypto.createHash('sha256').update(identifier).digest('hex');
    const documentKey = `doc_${hash.substring(0, 16)}`;

    console.log(`[get-key] Generated stable key for identifier: "${identifier}" -> ${documentKey}`);

    return NextResponse.json(
      {
        documentKey,
        identifier,
      },
      { headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('[get-key] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate document key' },
      { status: 500, headers: corsHeaders }
    );
  }
}
