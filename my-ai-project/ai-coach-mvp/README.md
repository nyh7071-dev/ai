# Repot AI

AI 기반 문서 작성 및 편집 워크스페이스입니다. Next.js App Router를 사용하고, 문서 편집은 OnlyOffice Document Server와 연동됩니다.

## Local Run

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

## Required Services

- Supabase
  - Google OAuth 로그인
- OnlyOffice Document Server
  - 기본값: `http://localhost:8080`
- OpenAI API
- Anthropic API

## Environment Variables

로컬 개발은 `.env.local`, 배포는 플랫폼 환경변수에 설정합니다.

필수 값은 [`.env.example`](c:/Users/nyh7071/Documents/GitHub/ai/my-ai-project/ai-coach-mvp/.env.example)에 정리되어 있습니다.

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_ONLYOFFICE_URL`
- `FILE_PUBLIC_BASE_URL`
- `FILE_ACCESS_TOKEN_SECRET`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `MULTI_AGENT_CRITIC_PROVIDER`

## Current Storage Model

- 업로드 파일은 `public/`이 아니라 서버 내부 `.data/uploads`에 저장됩니다.
- 파일 접근은 `/api/onlyoffice/file/[fileId]?token=...` 경로로만 허용됩니다.
- 파일 토큰은 서버에서 서명되며 만료 시간이 있습니다.
- 사용자 작업 일부는 브라우저 IndexedDB에도 저장됩니다.

## Production Checklist

배포 전에 아래 항목을 반드시 확인하세요.

1. `FILE_ACCESS_TOKEN_SECRET`를 긴 랜덤 문자열로 설정합니다.
2. `.env.local`에 있던 기존 OpenAI, Anthropic 키가 외부에 노출되었으면 폐기 후 재발급합니다.
3. Supabase Google OAuth Redirect URL에 실제 서비스 도메인과 `/auth/callback`을 등록합니다.
4. `FILE_PUBLIC_BASE_URL`을 실제 서비스 도메인으로 설정합니다.
5. `NEXT_PUBLIC_ONLYOFFICE_URL`을 실제 OnlyOffice 서버 주소로 설정합니다.
6. `.data/uploads`가 배포 환경에서 지속 저장되는지 확인합니다.
7. HTTPS 환경에서 OnlyOffice callback과 file URL이 모두 정상 접근 가능한지 확인합니다.
8. 로그인 없이 `/project/*` 경로에 접근했을 때 `/login`으로 이동하는지 확인합니다.
9. 업로드된 파일 URL에 토큰 없이 접근 시 `401`이 반환되는지 확인합니다.
10. 실제 배포 환경에서 Google 로그인 완료 후 세션이 유지되는지 확인합니다.

상세 점검 순서는 [deployment-checklist.md](c:/Users/nyh7071/Documents/GitHub/ai/my-ai-project/ai-coach-mvp/docs/deployment-checklist.md)를 따르세요.

## Operational Risks Still Remaining

현재 구조는 프로토타입에서 실서비스 초입으로 올리는 단계입니다. 아래는 아직 남아 있는 리스크입니다.

- 파일 소유권이 아직 DB 기준으로 관리되지 않습니다.
  - 현재는 파일별 서명 토큰으로 접근을 제한합니다.
- 사용자 작업 데이터의 주요 저장소가 아직 IndexedDB입니다.
  - 기기 간 동기화, 관리자 복구, 서버 백업이 어렵습니다.
- 업로드 파일 보관 정책과 자동 삭제 정책이 없습니다.
- OnlyOffice 연동은 외부 Document Server 운영 상태에 의존합니다.

## Recommended Next Steps

1. Supabase DB에 `files`, `workspaces` 테이블을 만들고 사용자 소유권을 서버 기준으로 저장합니다.
2. IndexedDB 중심 저장을 서버 저장 중심으로 바꿉니다.
3. 업로드 파일 만료 삭제 작업을 추가합니다.
4. 운영 로그와 오류 추적 도구를 붙입니다.
5. 관리자 없이도 점검 가능한 헬스체크와 배포 점검 문서를 추가합니다.
