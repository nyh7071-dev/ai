# Deployment Checklist

## Before Deploy

1. Supabase에 [schema.sql](c:/Users/nyh7071/Documents/GitHub/ai/my-ai-project/ai-coach-mvp/supabase/schema.sql)을 적용합니다.
2. Supabase Storage bucket을 생성합니다.
3. 환경변수를 모두 설정합니다.
4. 기존에 노출된 OpenAI, Anthropic 키는 폐기 후 재발급합니다.

필수 환경변수:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_ONLYOFFICE_URL`
- `FILE_PUBLIC_BASE_URL`
- `FILE_ACCESS_TOKEN_SECRET`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

## Smoke Test

배포 직후 최소 이 순서로 점검합니다.

1. `/` 접속 확인
2. 로그인 없이 `/project/new/result` 접속
3. `/login` 리다이렉트 확인
4. Google 로그인 수행
5. 로그인 완료 후 `/` 복귀 확인
6. 기본 템플릿 자동 로드 확인
7. DOCX 업로드 확인
8. PDF 또는 DOCX 소스 업로드 확인
9. AI 자동 채우기 실행 확인
10. 편집 후 다운로드 확인

## Security Test

1. 업로드된 파일 URL에서 `token` 제거 후 접속
   기대값: `401`
2. 다른 사용자 계정으로 로그인 후 이전 사용자 워크스페이스 ID로 접근
   기대값: 로컬 캐시가 없다면 복원 실패
3. `.env.local`이나 배포 환경변수에 실제 비밀키가 프론트에 노출되지 않는지 확인
4. 브라우저 개발자도구 Network 탭에서 `SUPABASE_SERVICE_ROLE_KEY`가 절대 노출되지 않는지 확인

## Document Flow Test

1. 기본 템플릿 진입
2. 슬롯 스캔 결과 표시 확인
3. 소스 파일 업로드
4. AI 자동 채우기
5. OnlyOffice 편집기 표시
6. 수동 편집
7. 다시 저장된 문서 반영 확인
8. 새로고침 후 워크스페이스 복원 확인

## Cross-Session Test

1. 로그인 상태에서 문서를 하나 생성
2. 워크스페이스 URL 확보
3. 브라우저 새 창 또는 다른 브라우저에서 같은 계정 로그인
4. 같은 워크스페이스 ID로 복원 시도
5. 메시지, 슬롯, 결과 메타데이터가 복원되는지 확인

주의:

- 현재 메타데이터 복원은 Supabase 기반이지만 바이너리 문서 완전 복원은 배포 환경 설정에 따라 달라질 수 있습니다.
- Supabase Storage 미러링은 `SUPABASE_SERVICE_ROLE_KEY`와 `SUPABASE_STORAGE_BUCKET`이 설정된 경우에만 동작합니다.

## Failure Cases To Check

1. `OPENAI_API_KEY` 제거 후 AI 요청
   기대값: 서버 오류로 실패, 로그에 원인 명시
2. `FILE_ACCESS_TOKEN_SECRET` 제거 후 production 실행
   기대값: 업로드/조회 라우트가 설정 오류로 실패
3. OnlyOffice 서버 중지 후 편집기 진입
   기대값: 편집기 로드 실패, 콘솔에서 원인 확인 가능
4. Supabase Storage bucket 이름 오타
   기대값: 로컬 fallback은 되더라도 storage sync 경고 로그 발생

## Recommended Manual Sign-Off

- 로그인
- 업로드
- AI 채우기
- 편집
- 다운로드
- 새로고침 복원
- 다른 계정 접근 차단
- 토큰 없는 파일 접근 차단

위 8개를 모두 통과하면 제한적 공개 테스트 단계로 넘길 수 있습니다.
