# OnlyOffice Plugin - AI Assistant

이 플러그인은 OnlyOffice Document Server에서 실시간으로 AI가 생성한 콘텐츠를 문서에 반영하기 위해 사용됩니다.

## 아키텍처

### 플러그인 구조
```
ai-assistant/
├── config.json       # 플러그인 메타데이터
├── index.html        # 플러그인 UI (최소)
├── code.js           # 플러그인 로직
└── resources/
    └── icon.svg      # 플러그인 아이콘
```

### 통신 흐름

1. **플러그인 → 서버 (SSE)**
   - 플러그인은 `/api/sse/document/{documentKey}`에 SSE 연결
   - 서버로부터 실시간 패치를 수신

2. **서버 → 플러그인 (Push)**
   - AI가 콘텐츠 생성 완료
   - 서버가 `/api/realtime/push`로 패치 전송
   - SSE를 통해 모든 연결된 클라이언트에 브로드캐스트

3. **플러그인 → 문서 (Plugin API)**
   - 패치 수신 시 `window.Asc.plugin.callCommand` 사용
   - Content Controls 또는 SearchAndReplace로 텍스트 업데이트
   - 사용자 화면에 즉시 반영 (< 1초)

4. **사용자 편집 → 서버**
   - 사용자가 Content Control 편집
   - `onChangeContentControl` 이벤트 발생
   - `/api/realtime/user-edit`로 POST 전송
   - 서버가 사용자 편집 추적 (향후 AI 재생성 시 반영)

## 패치 형식

### setSlotText
Content Control 또는 placeholder를 특정 텍스트로 교체
```json
{
  "op": "setSlotText",
  "slot": "company_name",
  "text": "삼성전자 주식회사",
  "mode": "replace"
}
```

### deleteSlot
슬롯 내용 삭제 (예: 예시 텍스트 제거)
```json
{
  "op": "deleteSlot",
  "slot": "example_text"
}
```

### replaceText
전체 문서에서 특정 텍스트 검색 및 교체
```json
{
  "op": "replaceText",
  "search": "홍길동",
  "replace": "김철수"
}
```

### batchUpdate
여러 업데이트를 한 번에 적용
```json
{
  "op": "batchUpdate",
  "updates": [
    { "op": "setSlotText", "slot": "name", "text": "김철수" },
    { "op": "setSlotText", "slot": "company", "text": "삼성전자" }
  ]
}
```

## Content Controls

템플릿 분석 후 placeholder를 Content Control로 래핑:

```xml
<w:sdt>
  <w:sdtPr>
    <w:id w:val="1000"/>
    <w:tag w:val="company_name"/>
    <w:alias w:val="company_name"/>
  </w:sdtPr>
  <w:sdtContent>
    <w:r>
      <w:t>____</w:t>
    </w:r>
  </w:sdtContent>
</w:sdt>
```

## 개발 워크플로우

### 1. 템플릿 업로드
- 사용자가 DOCX 템플릿 업로드
- `/api/template/analyze`로 템플릿 분석
- `classifiedIR` 생성 (PLACEHOLDER, INSTRUCTION, EXAMPLE 등 분류)
- `/api/template/annotate`로 Content Controls 삽입

### 2. 자료 업로드 및 AI 생성
- 사용자가 참고 자료 업로드
- "AI 자동 채우기 (DOCX)" 버튼 클릭
- `/api/analyze-form`으로 슬롯 값 생성
- `/api/realtime/push`로 패치 전송

### 3. 실시간 반영
- SSE를 통해 플러그인에 패치 도착
- 플러그인이 `executeMethod` 또는 `callCommand` 실행
- 사용자 화면에 즉시 표시

### 4. 사용자 편집
- 사용자가 문서 직접 편집
- Content Control 변경 감지
- `/api/realtime/user-edit`로 전송
- 서버가 사용자 편집 기록

## 로컬 개발

1. 개발 서버 시작:
```bash
npm run dev
```

2. OnlyOffice Document Server 시작:
```bash
docker-compose up -d
```

3. 브라우저에서 접속:
```
http://localhost:3000/project/new/result
```

4. DOCX 업로드 및 플러그인 자동 로드

## 디버깅

### 플러그인 로그 확인
브라우저 개발자 도구 → Console:
```
[AI Assistant] Plugin initialized
[AI Assistant] Connecting to SSE: http://localhost:3000/api/sse/document/...
[AI Assistant] SSE connected
[AI Assistant] Received message: {...}
[AI Assistant] Handling patch: {...}
```

### SSE 연결 확인
```bash
curl -N http://localhost:3000/api/sse/document/test-key
```

### 패치 전송 테스트
```bash
curl -X POST http://localhost:3000/api/realtime/push \
  -H "Content-Type: application/json" \
  -d '{
    "documentKey": "test-key",
    "patch": {
      "op": "setSlotText",
      "slot": "name",
      "text": "테스트"
    }
  }'
```

## 제약사항

1. **OnlyOffice 버전**: Document Server v7.0 이상 필요
2. **브라우저**: Chrome, Edge, Firefox 최신 버전
3. **네트워크**: 플러그인은 localhost:3000에 접근 가능해야 함
4. **동시 접속**: 여러 사용자가 동시에 같은 문서 편집 가능 (SSE 브로드캐스트)

## 향후 개선

- [ ] WebSocket 지원 (SSE 대신, 양방향 통신)
- [ ] 플러그인 UI 추가 (슬롯 목록 표시, 수동 재생성 버튼)
- [ ] Undo/Redo 히스토리 관리
- [ ] 충돌 해결 (여러 사용자 동시 편집 시)
- [ ] 오프라인 모드 지원
