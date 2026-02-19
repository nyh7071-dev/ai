# DOCX Fill Ops API 사용 가이드

## 개요

`/api/docx/fill-ops` API는 DOCX 템플릿에 write_ops.json을 적용하여 filled.docx를 생성합니다.

---

## API 명세

### Endpoint

```
POST /api/docx/fill-ops
```

### Request

**Content-Type:** `multipart/form-data`

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `template` | File | ✅ | DOCX 템플릿 파일 |
| `ops` | JSON string or File | ✅ | write_ops 배열 |
| `skipEmpty` | string | ❌ | `"1"` → 빈 값 ops 건너뜀 |
| `debug` | string | ❌ | `"1"` → JSON 응답 모드 |

**ops 형식:**
```json
[
  {
    "xmlPath": "document:table5:r1:c1",
    "value": "홍길동",
    "key": "representative_name",
    "slot": "s_000001"
  },
  {
    "xmlPath": "document:table6:r0:c0",
    "value": "AI 기반 문서 자동화 플랫폼"
  }
]
```

**xmlPath 규칙:**
- 형식: `document:table{n}:r{row}:c{col}`
- `table{n}`: 1-based table index (최상위 테이블만, 중첩 테이블 제외)
- `r{row}`: 0-based row index
- `c{col}`: 0-based cell index

### Response

#### 일반 모드 (default)

**Status:** `200 OK`

**Headers:**
- `Content-Type`: `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- `Content-Disposition`: `attachment; filename="filled.docx"`
- `X-Fill-Summary`: JSON 문자열 (summary)

**Body:** DOCX 바이너리

**X-Fill-Summary 형식:**
```json
{
  "ok": 11,
  "fail": 0,
  "badPath": 0,
  "noTable": 0,
  "noRow": 0,
  "noCell": 0,
  "topTables": 15
}
```

#### Debug 모드 (`debug=1`)

**Status:** `200 OK`

**Body:**
```json
{
  "summary": {
    "ok": 11,
    "fail": 0,
    "badPath": 0,
    "noTable": 0,
    "noRow": 0,
    "noCell": 0,
    "topTables": 15
  },
  "base64Docx": "UEsDBBQABgAIAAAAIQD..."
}
```

#### 에러

**Status:** `400` or `500`

**Body:**
```json
{
  "error": "에러 메시지",
  "details": "상세 정보",
  "stack": "스택 트레이스 (development only)"
}
```

---

## 사용 예시

### 1. curl (Bash/Linux/Mac)

#### 기본 사용

```bash
curl -X POST http://localhost:3000/api/docx/fill-ops \
  -F "template=@./template.docx" \
  -F "ops=@./write_ops.json" \
  --output filled.docx
```

#### skipEmpty 옵션

```bash
curl -X POST http://localhost:3000/api/docx/fill-ops \
  -F "template=@./template.docx" \
  -F "ops=@./write_ops.nonempty.json" \
  -F "skipEmpty=1" \
  --output filled.docx
```

#### Debug 모드

```bash
curl -X POST http://localhost:3000/api/docx/fill-ops \
  -F "template=@./template.docx" \
  -F "ops=@./write_ops.json" \
  -F "debug=1" \
  | jq .
```

#### Summary 확인

```bash
curl -X POST http://localhost:3000/api/docx/fill-ops \
  -F "template=@./template.docx" \
  -F "ops=@./write_ops.json" \
  -D - \
  --output filled.docx \
  | grep -i "x-fill-summary"
```

---

### 2. PowerShell (Windows)

**⚠️ 중요:** PowerShell에서는 파일을 직접 실행하세요. JS 코드를 직접 붙여넣지 마세요!

#### 기본 사용

**파일: `fill-docx.ps1`**
```powershell
$template = Get-Item "template.docx"
$ops = Get-Content "write_ops.json" -Raw

$form = @{
    template = $template
    ops = $ops
}

$response = Invoke-RestMethod `
    -Uri "http://localhost:3000/api/docx/fill-ops" `
    -Method Post `
    -Form $form `
    -OutFile "filled.docx"

Write-Host "✓ filled.docx 생성 완료"
```

**실행:**
```powershell
powershell -ExecutionPolicy Bypass -File fill-docx.ps1
```

#### Summary 확인

**파일: `fill-docx-debug.ps1`**
```powershell
$template = Get-Item "template.docx"
$ops = Get-Content "write_ops.json" -Raw

$form = @{
    template = $template
    ops = $ops
    debug = "1"
}

$response = Invoke-RestMethod `
    -Uri "http://localhost:3000/api/docx/fill-ops" `
    -Method Post `
    -Form $form

Write-Host "Summary:"
Write-Host "  - ok: $($response.summary.ok)"
Write-Host "  - fail: $($response.summary.fail)"
Write-Host "  - badPath: $($response.summary.badPath)"
Write-Host "  - noTable: $($response.summary.noTable)"
Write-Host "  - noRow: $($response.summary.noRow)"
Write-Host "  - noCell: $($response.summary.noCell)"
Write-Host "  - topTables: $($response.summary.topTables)"
```

**실행:**
```powershell
powershell -ExecutionPolicy Bypass -File fill-docx-debug.ps1
```

---

### 3. Node.js 스크립트

**파일: `test-fill-api.js`**
```javascript
const fs = require('fs');
const FormData = require('form-data');
const fetch = require('node-fetch');

async function testFillApi() {
  const form = new FormData();
  form.append('template', fs.createReadStream('./template.docx'));
  form.append('ops', fs.readFileSync('./write_ops.json', 'utf8'));
  form.append('skipEmpty', '1');

  const response = await fetch('http://localhost:3000/api/docx/fill-ops', {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    const error = await response.json();
    console.error('에러:', error);
    return;
  }

  // Summary 추출
  const summary = JSON.parse(response.headers.get('x-fill-summary'));
  console.log('Summary:', summary);

  // 파일 저장
  const buffer = await response.buffer();
  fs.writeFileSync('./filled.docx', buffer);
  console.log('✓ filled.docx 생성 완료');
}

testFillApi().catch(console.error);
```

**실행:**
```bash
node test-fill-api.js
```

---

### 4. React 컴포넌트

**컴포넌트: `FillDocxButton.tsx`**
```tsx
"use client";

import React, { useState } from 'react';
import { fillDocxClient } from '@/lib/client/fillDocxClient';

export default function FillDocxButton() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [summary, setSummary] = useState<any>(null);

  const handleFill = async () => {
    // 파일 선택
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.docx';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      // Ops 정의
      const ops = [
        { xmlPath: "document:table5:r1:c1", value: "홍길동" },
        { xmlPath: "document:table5:r2:c1", value: "AI 플랫폼" },
        { xmlPath: "document:table6:r0:c0", value: "우리 회사는..." },
      ];

      setLoading(true);

      try {
        const result = await fillDocxClient(file, ops, {
          skipEmpty: true,
          onProgress: setProgress,
        });

        setSummary(result.summary);
        alert(`성공! ok=${result.summary.ok}, fail=${result.summary.fail}`);
      } catch (error: any) {
        alert(`에러: ${error.message}`);
      } finally {
        setLoading(false);
        setProgress('');
      }
    };
    input.click();
  };

  return (
    <div>
      <button onClick={handleFill} disabled={loading}>
        {loading ? progress || '처리 중...' : 'DOCX 채우기'}
      </button>

      {summary && (
        <div style={{ marginTop: '10px', fontSize: '12px' }}>
          <strong>Summary:</strong>
          <ul>
            <li>성공: {summary.ok}</li>
            <li>실패: {summary.fail}</li>
            <li>Top Tables: {summary.topTables}</li>
          </ul>
        </div>
      )}
    </div>
  );
}
```

---

### 5. React Hook 사용

```tsx
"use client";

import React from 'react';
import { useFillDocx } from '@/lib/client/fillDocxClient';

export default function FillDocxPage() {
  const { fillDocx, loading, progress, summary } = useFillDocx();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const file = (form.elements.namedItem('template') as HTMLInputElement).files?.[0];
    const opsText = (form.elements.namedItem('ops') as HTMLTextAreaElement).value;

    if (!file) {
      alert('파일을 선택하세요');
      return;
    }

    try {
      const ops = JSON.parse(opsText);
      await fillDocx(file, ops, { skipEmpty: true });
      alert('성공!');
    } catch (error: any) {
      alert(`에러: ${error.message}`);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label>Template DOCX:</label>
        <input type="file" name="template" accept=".docx" required />
      </div>

      <div>
        <label>Ops JSON:</label>
        <textarea
          name="ops"
          rows={10}
          defaultValue={JSON.stringify([
            { xmlPath: "document:table5:r1:c1", value: "홍길동" }
          ], null, 2)}
        />
      </div>

      <button type="submit" disabled={loading}>
        {loading ? progress : '채우기'}
      </button>

      {summary && (
        <div>
          <h3>결과</h3>
          <pre>{JSON.stringify(summary, null, 2)}</pre>
        </div>
      )}
    </form>
  );
}
```

---

## 테스트 시나리오

### 시나리오 1: 11개 ops 적용 (성공)

**write_ops.json:**
```json
[
  {"xmlPath": "document:table5:r1:c1", "value": "홍길동"},
  {"xmlPath": "document:table5:r2:c1", "value": "AI 플랫폼"},
  {"xmlPath": "document:table5:r3:c1", "value": "서울"},
  {"xmlPath": "document:table6:r0:c0", "value": "우리 회사는 AI 기반..."},
  {"xmlPath": "document:table6:r1:c0", "value": "제품 A는..."},
  {"xmlPath": "document:table6:r2:c0", "value": "시장 분석 결과..."},
  {"xmlPath": "document:table7:r0:c1", "value": "2026-01-15"},
  {"xmlPath": "document:table7:r1:c1", "value": "2026-06-30"},
  {"xmlPath": "document:table8:r0:c0", "value": "1억원"},
  {"xmlPath": "document:table8:r1:c0", "value": "5000만원"},
  {"xmlPath": "document:table8:r2:c0", "value": "3000만원"}
]
```

**예상 결과:**
```json
{
  "ok": 11,
  "fail": 0,
  "badPath": 0,
  "noTable": 0,
  "noRow": 0,
  "noCell": 0,
  "topTables": 15
}
```

### 시나리오 2: skipEmpty 테스트

**write_ops_with_empty.json:**
```json
[
  {"xmlPath": "document:table5:r1:c1", "value": "홍길동"},
  {"xmlPath": "document:table5:r2:c1", "value": ""},
  {"xmlPath": "document:table5:r3:c1", "value": "   "},
  {"xmlPath": "document:table6:r0:c0", "value": "유효한 값"}
]
```

**skipEmpty=0 (default):**
- table5:r2:c1, r3:c1 → 빈 값으로 덮어씀
- ok=4

**skipEmpty=1:**
- table5:r2:c1, r3:c1 → 건너뜀 (템플릿 라벨 유지)
- ok=2

### 시나리오 3: 에러 처리

**잘못된 xmlPath:**
```json
[
  {"xmlPath": "invalid:path", "value": "값"},
  {"xmlPath": "document:table99:r0:c0", "value": "값"},
  {"xmlPath": "document:table5:r99:c0", "value": "값"},
  {"xmlPath": "document:table5:r0:c99", "value": "값"}
]
```

**예상 결과:**
```json
{
  "ok": 0,
  "fail": 4,
  "badPath": 1,
  "noTable": 1,
  "noRow": 1,
  "noCell": 1,
  "topTables": 15
}
```

---

## 트러블슈팅

### 문제 1: "word/document.xml not found"

**원인:** 업로드한 파일이 유효한 DOCX가 아님

**해결:**
```bash
# ZIP 파일인지 확인
file template.docx
# 출력: Microsoft Word 2007+

# ZIP 내용 확인
unzip -l template.docx | grep "word/document.xml"
```

### 문제 2: "ops는 배열이어야 합니다"

**원인:** ops JSON이 객체 또는 잘못된 형식

**해결:**
```json
// ❌ 잘못된 형식
{
  "op1": {"xmlPath": "...", "value": "..."}
}

// ✅ 올바른 형식
[
  {"xmlPath": "...", "value": "..."}
]
```

### 문제 3: "summary.noTable > 0"

**원인:** tableId가 존재하지 않음 (최상위 테이블 개수 초과)

**해결:**
1. 템플릿의 최상위 테이블 개수 확인:
   ```bash
   curl -F "template=@template.docx" -F "ops=[]" -F "debug=1" \
     http://localhost:3000/api/docx/fill-ops \
     | jq '.summary.topTables'
   ```

2. xmlPath의 tableId를 1 ~ topTables 범위로 조정

### 문제 4: "summary.noRow > 0" 또는 "summary.noCell > 0"

**원인:** row/cell index가 범위를 벗어남

**해결:**
- Word에서 템플릿을 열고 실제 테이블 구조 확인
- row는 0-based (첫 행 = r0)
- cell은 0-based (첫 열 = c0)

---

## 성능 최적화

### 대용량 ops 처리

- **권장 ops 개수:** 1000개 이하
- **1000개 이상:** 배치로 나눠서 처리

```javascript
// 1000개씩 배치 처리
const batchSize = 1000;
for (let i = 0; i < allOps.length; i += batchSize) {
  const batch = allOps.slice(i, i + batchSize);
  await fillDocxClient(templateFile, batch);
}
```

### 메모리 최적화

- 큰 DOCX (> 10MB)는 서버 메모리 증가
- `NODE_OPTIONS=--max-old-space-size=4096` 설정

---

## 완료 기준 (Acceptance Criteria)

✅ **기본 기능:**
- [ ] curl로 호출 시 filled.docx 다운로드됨
- [ ] Word에서 열었을 때 table5/table6 값이 변경됨
- [ ] 11개 ops 적용 시 `summary.ok=11`

✅ **skipEmpty 옵션:**
- [ ] skipEmpty=0: 빈 값도 적용 (셀이 빈 값으로 덮어씀)
- [ ] skipEmpty=1: 빈 값 건너뜀 (템플릿 라벨 유지)

✅ **에러 처리:**
- [ ] 잘못된 xmlPath → `badPath` 증가
- [ ] 존재하지 않는 table → `noTable` 증가
- [ ] 존재하지 않는 row → `noRow` 증가
- [ ] 존재하지 않는 cell → `noCell` 증가

✅ **응답:**
- [ ] 일반 모드: DOCX 파일 + `X-Fill-Summary` 헤더
- [ ] Debug 모드: JSON with `summary` + `base64Docx`

---

## 추가 기능 (향후)

- [ ] 여러 파일 배치 처리
- [ ] 진행률 스트리밍 (SSE)
- [ ] 캐싱 (동일 template 재사용)
- [ ] 비동기 작업 큐 (Redis/Bull)
- [ ] 웹훅 콜백 (완료 시 알림)
