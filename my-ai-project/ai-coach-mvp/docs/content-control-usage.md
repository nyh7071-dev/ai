# Content Control 기반 자동 채우기 시스템

## 개요

이 시스템은 3단계로 구성됩니다:
1. **분석 (Analyze)**: DOCX 템플릿에서 Slot 추출
2. **계측 (Instrument)**: Slot 위치에 Content Control 삽입
3. **채우기 (Fill)**: Content Control을 통한 배치 채우기

---

## 1단계: 템플릿 분석

### API: POST /api/template/analyze

```typescript
const formData = new FormData();
formData.append('file', docxFile);

const response = await fetch('/api/template/analyze', {
  method: 'POST',
  body: formData
});

const { ir, slotSchema } = await response.json();

// slotSchema.slots 예시:
// [
//   {
//     slot_id: "s_000001",
//     label: "사업명",
//     slot_type: "short_text",
//     selector: {
//       strategy: "table_cell",
//       path: {
//         block_id: "b2",
//         row: 0,
//         cell: 1,
//         xmlStart: 54320,
//         xmlEnd: 54892
//       }
//     }
//   },
//   ...
// ]
```

---

## 2단계: Content Control 계측

### API: POST /api/template/instrument

```typescript
// DOCX를 Base64로 인코딩
const arrayBuffer = await docxFile.arrayBuffer();
const buffer = Buffer.from(arrayBuffer);
const docxBase64 = buffer.toString('base64');

// 계측 API 호출
const response = await fetch('/api/template/instrument', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    docxBase64: docxBase64,
    slots: slotSchema.slots
  })
});

// 계측된 DOCX 다운로드
const instrumentedBlob = await response.blob();
const instrumentedFile = new File([instrumentedBlob], 'instrumented.docx', {
  type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
});

// 헤더에서 통계 확인
const insertedCount = response.headers.get('X-Inserted-Count');
const skippedCount = response.headers.get('X-Skipped-Count');
console.log(`삽입: ${insertedCount}, 스킵: ${skippedCount}`);
```

### 계측 결과 확인

OnlyOffice에서 열고 플러그인 콘솔에서:

```javascript
// 매크로 실행
(function() {
  var oDocument = Api.GetDocument();
  var arrCCs = oDocument.GetAllContentControls();

  var tags = [];
  for (var i = 0; i < arrCCs.length; i++) {
    var cc = arrCCs[i];
    tags.push({
      tag: cc.GetTag(),
      alias: cc.GetAlias(),
      text: cc.GetRange().GetText().substring(0, 50)
    });
  }

  console.log("Content Controls:", tags);
  return tags.length;
})();
```

예상 출력:
```javascript
[
  { tag: "s_000001", alias: "사업명", text: "※ 예시: AI 기반..." },
  { tag: "s_000002", alias: "대표자명", text: "홍길동" },
  ...
]
```

---

## 3단계: 배치 채우기

### 방법 A: SSE를 통한 실시간 채우기

```typescript
// 서버에서 패치 전송
await fetch('/api/realtime/push', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    documentKey: 'doc_12345',
    patch: {
      op: 'batchFill',
      fills: [
        { slot_id: 's_000001', value: 'AI 기반 문서 자동화 플랫폼' },
        { slot_id: 's_000002', value: '홍길동' },
        {
          slot_id: 's_000003',
          value: '우리 팀은 AI 전문가로 구성되어 있습니다.\n총 5명이 참여합니다.'
        }
      ]
    }
  })
});
```

### 방법 B: 직접 ExecuteCommand 호출

```javascript
// OnlyOffice 플러그인에서 직접 호출
applyFillsBatch([
  { slot_id: 's_000001', value: 'AI 기반 문서 자동화 플랫폼' },
  { slot_id: 's_000002', value: '홍길동' },
  {
    slot_id: 's_000003',
    value: '우리 팀은 AI 전문가로 구성되어 있습니다.\n총 5명이 참여합니다.'
  }
]);
```

### 배치 채우기 결과

콘솔 출력:
```
[AI Assistant] Batch applying 3 fills
[AI Assistant] Batch fill complete: 3 ok, 0 fail, 0 misses
```

실패한 경우:
```
[AI Assistant] Batch fill complete: 2 ok, 0 fail, 1 misses
[AI Assistant] Missing tags: ["s_000999"]
```

---

## 완전한 워크플로우 예시

```typescript
// 1. 템플릿 업로드 및 분석
const analyzeFormData = new FormData();
analyzeFormData.append('file', originalDocxFile);

const analyzeResponse = await fetch('/api/template/analyze', {
  method: 'POST',
  body: analyzeFormData
});

const { slotSchema } = await analyzeResponse.json();
console.log(`발견된 슬롯: ${slotSchema.slots.length}개`);

// 2. Content Control 계측
const buffer = Buffer.from(await originalDocxFile.arrayBuffer());
const instrumentResponse = await fetch('/api/template/instrument', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    docxBase64: buffer.toString('base64'),
    slots: slotSchema.slots
  })
});

const instrumentedBlob = await instrumentResponse.blob();
const instrumentedFile = new File([instrumentedBlob], 'instrumented.docx', {
  type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
});

// 3. 계측된 파일을 OnlyOffice에 업로드
const uploadFormData = new FormData();
uploadFormData.append('file', instrumentedFile);

const uploadResponse = await fetch('/api/upload', {
  method: 'POST',
  body: uploadFormData
});

const { fileId } = await uploadResponse.json();

// 4. OnlyOffice에서 파일 열기
window.open(`/editor?fileId=${fileId}`);

// 5. AI가 내용 생성 후 채우기
const fills = await generateFillsWithAI(slotSchema.slots);

await fetch('/api/realtime/push', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    documentKey: fileId,
    patch: {
      op: 'batchFill',
      fills: fills
    }
  })
});
```

---

## 주요 특징

### ✅ 안정성
- **순서 독립적**: block_id 방식과 달리 태그 기반이므로 문서 구조 변경에 강함
- **배치 처리**: 단일 ExecuteCommand로 모든 채우기 수행 (경합 없음)
- **중복 방지**: 이미 계측된 슬롯은 재계측하지 않음

### ✅ 정확성
- **xmlStart/xmlEnd**: 정확한 XML 위치 기반 계측
- **역순 처리**: 뒤에서부터 삽입하여 offset shift 방지
- **tcPr 보존**: 셀 속성(병합, 너비 등) 유지

### ✅ 확장성
- **다중 줄 지원**: `\n`으로 여러 단락 생성
- **실패 추적**: ok/fail/misses 통계 제공
- **사용자 편집 추적**: Content Control 변경 이벤트 감지 가능

---

## 트러블슈팅

### 문제: "Content Control이 보이지 않습니다"

**해결:**
1. OnlyOffice 콘솔에서 확인:
   ```javascript
   Api.GetDocument().GetAllContentControls().length
   ```
2. 0이면 계측이 안된 것 → /api/template/instrument 재호출
3. 0 이상이면 태그 확인:
   ```javascript
   Api.GetDocument().GetAllContentControls()[0].GetTag()
   ```

### 문제: "Batch fill에서 misses가 많습니다"

**원인:**
- 계측된 파일이 아닌 원본 파일을 열었음
- slot_id와 실제 태그가 불일치

**해결:**
1. 계측된 파일을 사용하는지 확인
2. 태그 목록과 fills의 slot_id 비교:
   ```javascript
   var tags = Api.GetDocument().GetAllContentControls().map(cc => cc.GetTag());
   console.log("Available tags:", tags);
   ```

### 문제: "xmlStart/xmlEnd가 없는 슬롯이 있습니다"

**원인:**
- 파싱 단계에서 위치 정보 누락
- 문서 구조가 복잡하거나 중첩됨

**해결:**
- fallback 구현 필요 (block_id + row + cell로 찾기)
- 현재는 xmlStart가 없으면 스킵됨

---

## API 참조

### POST /api/template/instrument

**Request:**
```typescript
{
  docxBase64: string;     // Base64 encoded DOCX
  slots: Slot[];          // SlotSchema의 slots 배열
}
```

**Response:**
- 성공: instrumented DOCX binary
- 헤더:
  - `X-Inserted-Count`: 삽입된 CC 개수
  - `X-Skipped-Count`: 스킵된 슬롯 개수

**Response (에러):**
```json
{
  "error": "에러 메시지"
}
```

### Patch Operation: batchFill

**SSE 메시지:**
```json
{
  "op": "batchFill",
  "fills": [
    { "slot_id": "s_000001", "value": "값1" },
    { "slot_id": "s_000002", "value": "값2\n줄바꿈" }
  ]
}
```

**ExecuteCommand 결과:**
```typescript
{
  ok: number;        // 성공한 채우기 수
  fail: number;      // 실패한 채우기 수
  misses: string[];  // 찾을 수 없었던 slot_id 목록
}
```

---

## 다음 개발 과제

- [ ] xmlStart/xmlEnd 없는 슬롯 fallback 구현
- [ ] heading_section 전략 지원
- [ ] table_repeat (반복표) 지원
- [ ] Content Control 스타일 커스터마이징
- [ ] Undo/Redo 히스토리 관리
- [ ] 사용자 수동 편집과 AI 채우기 충돌 해결
