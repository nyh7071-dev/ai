# Content Control 시스템 검증 가이드

## 개요

이 문서는 Content Control 기반 자동 채우기 시스템의 3단계 검증 프로세스를 설명합니다.

---

## 검증 1: Instrument API (서버)

### API 실행

```typescript
const response = await fetch('/api/template/instrument', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    docxBase64: base64String,
    slots: slotSchema.slots
  })
});
```

### 예상 콘솔 출력

```
[Instrument] API 호출됨
[Instrument] 처리할 table_cell 슬롯: 45개
[Instrument] 기존 태그: 0개
[Instrument] ✓ 삽입: s_000001 (사업명)
[Instrument] ✓ 삽입: s_000002 (대표자명)
...
[Instrument] 완료: 삽입=45, 스킵=0

[Instrument 검증 1] SDT/Tag 개수
  - <w:sdt> 개수: 45
  - <w:tag w:val="> 개수: 45

[Instrument 검증 2] 샘플 slot_id 존재 여부
  - s_000001: ✓ 존재
  - s_000002: ✓ 존재
  - s_000003: ✓ 존재

[Instrument 검증 3] xmlStart 위치 판정
  - 첫 슬롯: s_000001 (사업명)
  - xmlStart: 54320
  - body 시작 위치: 1850
  - probe(절대): "<w:tc><w:tcPr><w:tc"
  - probe(body 상대): "nt><w:pPr><w:pSty"
  - 절대 위치가 <w:tc>로 시작: true
  - body 상대 위치가 <w:tc>로 시작: false
  - ✓ xmlStart_is_absolute=true

[Instrument] 검증 완료
```

### 검증 포인트

| 항목 | 기대값 | 의미 |
|------|--------|------|
| `<w:sdt>` 개수 | > 0, == 삽입 개수 | Content Control이 삽입됨 |
| `<w:tag w:val=">` 개수 | == `<w:sdt>` 개수 | 모든 CC에 태그가 있음 |
| 샘플 slot_id 존재 | 모두 ✓ | slot_id가 태그로 정상 삽입됨 |
| `xmlStart_is_absolute` | true | xmlStart/xmlEnd는 절대 위치 |

### Response Headers

```
X-Inserted-Count: 45
X-Skipped-Count: 0
X-SDT-Count: 45
X-Tag-Count: 45
```

---

## 검증 2: Content Control 태그 확인 (OnlyOffice)

### 자동 검증

Instrumented DOCX를 OnlyOffice에서 열면 **2초 후 자동으로 검증 실행**:

```
[AI Assistant] Plugin initialized
[AI Assistant] Connecting to SSE: http://localhost:3000/api/sse/document/doc_12345
[AI Assistant] SSE connected
[AI Assistant] Verifying Content Controls...

[CC 검증] Content Control 확인 결과
  - Total CCs: 45
  - Sample tags (첫 10개):
    [0] tag=s_000001, alias=사업명
        text=※ 예시: AI 기반 문서 자동화 플랫폼
    [1] tag=s_000002, alias=대표자명
        text=홍길동
    [2] tag=s_000003, alias=문제 인식(Problem)
        text=※ 예시: 중소기업은 매일 반복되는 문서 작업에...
    [3] tag=s_000004, alias=해결 방안(Solution)
        text=※ 예시: 생성형 AI를 활용하여...
    ...
```

### 수동 검증

OnlyOffice 콘솔에서:

```javascript
// 전역 함수 호출
window.verifyContentControls();

// 또는 직접 ExecuteCommand
(function() {
  var oDocument = Api.GetDocument();
  var arrCCs = oDocument.GetAllContentControls();

  console.log("Total:", arrCCs.length);
  arrCCs.slice(0, 5).forEach(function(cc, i) {
    console.log(i + ": " + cc.GetTag() + " - " + cc.GetAlias());
  });
})();
```

### 검증 포인트

| 항목 | 기대값 | 의미 |
|------|--------|------|
| Total CCs | > 0, == 서버 삽입 개수 | CC가 정상 로드됨 |
| tag 형식 | `s_XXXXXX` 형식 | slot_id가 태그로 사용됨 |
| alias | 라벨 텍스트 (예: "사업명") | 사람이 읽기 쉬운 별칭 |
| textPreview | 기존 내용 보존됨 | 플레이스홀더가 유지됨 |

---

## 검증 3: Batch Fill 결과 (OnlyOffice)

### SSE를 통한 Batch Fill

```typescript
await fetch('/api/realtime/push', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    documentKey: 'doc_12345',
    patch: {
      op: 'batchFill',
      fills: [
        { slot_id: 's_000001', value: 'AI 문서 자동화 플랫폼' },
        { slot_id: 's_000002', value: '홍길동' },
        { slot_id: 's_000003', value: '중소기업은 문서 작업에\n하루 평균 2시간을 소비합니다.' }
      ]
    }
  })
});
```

### 예상 콘솔 출력 (성공 케이스)

```
[AI Assistant] Batch applying 3 fills

[Batch Fill 검증] 배치 채우기 결과
  - 요청한 fills 수: 3
  - 성공 (ok): 3
  - 실패 (fail): 0
  - 찾을 수 없음 (misses): 0

  ✅ 모든 채우기 성공!
```

### 예상 콘솔 출력 (일부 실패 케이스)

```
[AI Assistant] Batch applying 5 fills

[Batch Fill 검증] 배치 채우기 결과
  - 요청한 fills 수: 5
  - 성공 (ok): 3
  - 실패 (fail): 0
  - 찾을 수 없음 (misses): 2

  ⚠️  Missing slot_ids:
    - s_000999
    - s_001000

  ⚠️  일부 채우기 실패 또는 누락
```

### 수동 테스트

OnlyOffice 콘솔에서:

```javascript
// 전역 함수 호출
window.applyFillsBatch([
  { slot_id: 's_000001', value: '테스트 값 1' },
  { slot_id: 's_000002', value: '줄바꿈\n포함\n테스트' }
]);
```

### 검증 포인트

| 항목 | 기대값 | 의미 |
|------|--------|------|
| ok | == fills.length | 모든 채우기 성공 |
| fail | 0 | 에러 없음 |
| misses.length | 0 | 모든 태그 찾음 |
| 실행 시간 | < 2초 | 단일 Command로 빠름 |

---

## 완전한 워크플로우 테스트

### 1단계: 템플릿 분석

```bash
curl -X POST http://localhost:3000/api/template/analyze \
  -F "file=@template.docx"
```

**예상 응답:**
```json
{
  "slotSchema": {
    "template_id": "abc123...",
    "slots": [
      {
        "slot_id": "s_000001",
        "label": "사업명",
        "selector": {
          "strategy": "table_cell",
          "path": {
            "block_id": "b2",
            "row": 0,
            "cell": 1,
            "xmlStart": 54320,
            "xmlEnd": 54892
          }
        }
      },
      ...
    ]
  }
}
```

### 2단계: Content Control 계측

```bash
curl -X POST http://localhost:3000/api/template/instrument \
  -H "Content-Type: application/json" \
  -d @instrument-payload.json \
  -o instrumented.docx
```

**서버 콘솔 확인:**
- ✅ `<w:sdt>` 개수 > 0
- ✅ `xmlStart_is_absolute=true`
- ✅ 샘플 slot_id 모두 존재

### 3단계: OnlyOffice에서 열기

**브라우저 콘솔 확인 (2초 후):**
- ✅ Total CCs > 0
- ✅ tag 형식 정상 (`s_XXXXXX`)
- ✅ alias에 라벨 표시

### 4단계: 배치 채우기

```bash
curl -X POST http://localhost:3000/api/realtime/push \
  -H "Content-Type: application/json" \
  -d '{
    "documentKey": "doc_12345",
    "patch": {
      "op": "batchFill",
      "fills": [
        {"slot_id": "s_000001", "value": "테스트 값"}
      ]
    }
  }'
```

**브라우저 콘솔 확인:**
- ✅ ok == fills.length
- ✅ fail == 0
- ✅ misses.length == 0
- ✅ "모든 채우기 성공!" 메시지

---

## 트러블슈팅

### 문제 1: `<w:sdt>` 개수가 0

**원인:**
- 슬롯에 xmlStart/xmlEnd가 없음
- xmlStart가 유효하지 않음

**해결:**
```javascript
// slots 확인
console.log(slots.filter(s => !s.selector.path.xmlStart));

// 파서 재실행 필요
```

### 문제 2: Total CCs가 0 (OnlyOffice)

**원인:**
- Instrumented DOCX가 아닌 원본 파일 열림
- Content Control이 삽입되지 않음

**해결:**
1. 파일명 확인 (instrumented.docx인지)
2. Response Headers 확인 (`X-SDT-Count`)
3. 계측 재실행

### 문제 3: Batch Fill에서 misses 발생

**원인:**
- fills의 slot_id와 실제 태그 불일치
- 계측된 파일이 아님

**해결:**
```javascript
// 태그 목록 확인
window.verifyContentControls();

// 태그 비교
var existingTags = Api.GetDocument().GetAllContentControls()
  .map(cc => cc.GetTag());
console.log("Available:", existingTags);
console.log("Requested:", fills.map(f => f.slot_id));
```

### 문제 4: xmlStart_is_absolute=false

**원인:**
- 파서가 body 상대 위치로 저장함
- 코드 로직 불일치

**해결:**
- 파서 코드 확인 (`docx-parser.ts:76`)
- bodyMatch.index 오프셋 추가 여부 확인

---

## 성공 기준 체크리스트

### ✅ Instrument API (서버)
- [ ] `<w:sdt>` 개수 > 0
- [ ] `<w:tag w:val=">` 개수 == `<w:sdt>` 개수
- [ ] 샘플 slot_id 3개 모두 존재
- [ ] `xmlStart_is_absolute=true`
- [ ] 삽입 개수 == 예상 슬롯 수

### ✅ Content Control 확인 (OnlyOffice)
- [ ] Total CCs > 0
- [ ] Total CCs == 서버 삽입 개수
- [ ] tag 형식 정상 (`s_XXXXXX`)
- [ ] alias에 라벨 표시
- [ ] textPreview에 기존 내용 보존

### ✅ Batch Fill (OnlyOffice)
- [ ] ok == fills.length
- [ ] fail == 0
- [ ] misses.length == 0
- [ ] "모든 채우기 성공!" 메시지
- [ ] 문서에 값이 실제로 채워짐

---

## 예시 로그 (전체)

### 서버 콘솔
```
[Instrument] API 호출됨
[Instrument] 처리할 table_cell 슬롯: 45개
[Instrument] 완료: 삽입=45, 스킵=0

[Instrument 검증 1] SDT/Tag 개수
  - <w:sdt> 개수: 45
  - <w:tag w:val="> 개수: 45

[Instrument 검증 2] 샘플 slot_id 존재 여부
  - s_000001: ✓ 존재
  - s_000002: ✓ 존재
  - s_000003: ✓ 존재

[Instrument 검증 3] xmlStart 위치 판정
  - ✓ xmlStart_is_absolute=true

[Instrument] 검증 완료
```

### 브라우저 콘솔 (OnlyOffice)
```
[AI Assistant] Plugin initialized
[AI Assistant] SSE connected

[CC 검증] Content Control 확인 결과
  - Total CCs: 45
  - Sample tags (첫 10개):
    [0] tag=s_000001, alias=사업명
    ...

[AI Assistant] Batch applying 3 fills

[Batch Fill 검증] 배치 채우기 결과
  - 요청한 fills 수: 3
  - 성공 (ok): 3
  - 실패 (fail): 0
  - 찾을 수 없음 (misses): 0

  ✅ 모든 채우기 성공!
```

---

## 추가 디버깅 명령어

### 서버 (Node.js)

```javascript
// instrument 결과 상세 확인
const fs = require('fs');
const JSZip = require('jszip');

const buffer = fs.readFileSync('instrumented.docx');
const zip = await JSZip.loadAsync(buffer);
const xml = await zip.file('word/document.xml').async('string');

// SDT 개수
console.log('SDTs:', (xml.match(/<w:sdt/g) || []).length);

// 태그 목록
const tags = [...xml.matchAll(/<w:tag w:val="([^"]+)"/g)].map(m => m[1]);
console.log('Tags:', tags.slice(0, 10));
```

### 브라우저 (OnlyOffice)

```javascript
// 모든 CC의 tag, alias, text 덤프
(function() {
  var ccs = Api.GetDocument().GetAllContentControls();
  return ccs.map(function(cc, i) {
    return {
      index: i,
      tag: cc.GetTag(),
      alias: cc.GetAlias(),
      text: cc.GetRange().GetText().substring(0, 30)
    };
  });
})();

// 특정 태그로 CC 찾기
(function() {
  var ccs = Api.GetDocument().GetAllContentControls();
  for (var i = 0; i < ccs.length; i++) {
    if (ccs[i].GetTag() === 's_000001') {
      return {
        found: true,
        alias: ccs[i].GetAlias(),
        text: ccs[i].GetRange().GetText()
      };
    }
  }
  return { found: false };
})();
```

---

이 가이드를 따라 3단계 검증을 모두 통과하면, Content Control 기반 자동 채우기 시스템이 정상 작동하는 것입니다! 🎉
