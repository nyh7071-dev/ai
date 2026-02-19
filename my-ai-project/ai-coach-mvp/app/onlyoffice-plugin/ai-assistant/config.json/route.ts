/**
 * GET /onlyoffice-plugin/ai-assistant/config.json
 *
 * ONLYOFFICE 플러그인 설정 파일
 * CORS 헤더 포함 (localhost:8080에서 접근 가능)
 */

import { NextRequest, NextResponse } from 'next/server';

// 플러그인 설정
const pluginConfig = {
  name: "AI Assistant",
  guid: "asc.{F5F8D8F1-4B3E-4A5C-9D6E-1F2E3D4C5B6A}",
  version: "1.0.3",
  onlyofficeScheme: true,
  variations: [
    {
      description: "Real-time AI document filling",
      url: "index.html",
      icons: ["resources/icon.svg"],
      isViewer: false,
      EditorsSupport: ["word"],
      type: "background",
      isVisual: true,
      isInsideMode: false,
      initDataType: "none",
      buttons: []
    }
  ]
};

// CORS 헤더 (ONLYOFFICE Document Server용)
function getCorsHeaders(origin: string | null) {
  const allowedOrigins = [
    'http://localhost:8080',
    'http://127.0.0.1:8080',
  ];

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };

  // Origin 확인
  if (origin && allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  } else if (!origin) {
    // Origin 없는 요청은 모두 허용 (직접 접근)
    headers['Access-Control-Allow-Origin'] = '*';
  }

  return headers;
}

// OPTIONS preflight
export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin');
  console.log('[config.json] OPTIONS preflight from origin:', origin);

  return new NextResponse(null, {
    status: 200,
    headers: getCorsHeaders(origin),
  });
}

// GET config.json
export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin');
  console.log('[config.json] GET request from origin:', origin);

  return NextResponse.json(pluginConfig, {
    status: 200,
    headers: getCorsHeaders(origin),
  });
}
