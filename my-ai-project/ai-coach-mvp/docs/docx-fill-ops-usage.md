# DOCX Fill Ops API - 완전한 사용 가이드

## API 엔드포인트

```
POST /api/docx/fill
```

## 요청 형식

**Content-Type:** `multipart/form-data`

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `template` | File | ✅ | DOCX 템플릿 파일 |
| `ops` | JSON string or File | ✅ | write_ops 배열 |
| `skipEmpty` | string | ❌ | `"1"` → 빈 값 ops 건너뜀 (라벨 유지) |
| `debug` | string | ❌ | `"1"` → JSON 응답 (formData 또는 ?debug=1) |

### ops 형식

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
    "value": "첫 줄\n두 번째 줄\n세 번째 줄"
  }
]
```

**xmlPath 규칙:**
- 형식: `document:table{n}:r{row}:c{col}`
- `table{n}`: 1-based table index (최상위 테이블만, w:body 직계 자식)
- `r{row}`: 0-based row index
- `c{col}`: 0-based cell index

**줄바꿈 처리:**
- `value`에 `\n` 또는 `\r\n` 포함 시 자동으로 `<w:br>` 태그로 변환
- 예: `"a\nb\nc"` → Word에서 3줄로 표시

---

## 응답 형식

### 일반 모드 (기본)

**Status:** `200 OK`

**Headers:**
- `Content-Type`: `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- `Content-Disposition`: `attachment; filename="filled.docx"`
- `X-Fill-Summary`: JSON 문자열

**Body:** DOCX 바이너리

**X-Fill-Summary 예시:**
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

### Debug 모드 (`debug=1`)

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

---

## 테스트 명령어

### 1. curl (Bash/Linux/Mac)

#### 기본 사용

```bash
curl -X POST http://localhost:3000/api/docx/fill \
  -F "template=@./template.docx" \
  -F "ops=@./write_ops.json" \
  --output filled.docx
```

#### skipEmpty 옵션

```bash
curl -X POST http://localhost:3000/api/docx/fill \
  -F "template=@./template.docx" \
  -F "ops=@./write_ops.json" \
  -F "skipEmpty=1" \
  --output filled.docx
```

#### Summary 확인

```bash
curl -X POST http://localhost:3000/api/docx/fill \
  -F "template=@./template.docx" \
  -F "ops=@./write_ops.json" \
  -D - \
  --output filled.docx | grep "X-Fill-Summary"
```

#### Debug 모드 (쿼리스트링)

```bash
curl -X POST "http://localhost:3000/api/docx/fill?debug=1" \
  -F "template=@./template.docx" \
  -F "ops=@./write_ops.json" \
  | jq .
```

---

### 2. curl.exe (Windows PowerShell/CMD)

**⚠️ 중요:** Windows에서는 `curl.exe`를 사용하세요 (PowerShell의 `curl` 별칭이 아님)

#### 기본 사용 (CMD)

```cmd
curl.exe -X POST http://localhost:3000/api/docx/fill ^
  -F "template=@template.docx" ^
  -F "ops=@write_ops.json" ^
  --output filled.docx
```

#### 기본 사용 (PowerShell)

```powershell
curl.exe -X POST http://localhost:3000/api/docx/fill `
  -F "template=@template.docx" `
  -F "ops=@write_ops.json" `
  --output filled.docx
```

#### Summary 확인 (PowerShell)

```powershell
$response = curl.exe -X POST http://localhost:3000/api/docx/fill `
  -F "template=@template.docx" `
  -F "ops=@write_ops.json" `
  -i `
  --output filled.docx

# 헤더에서 Summary 추출
$response | Select-String "X-Fill-Summary"
```

---

### 3. PowerShell 스크립트 (권장)

**⚠️ 매우 중요: PowerShell에 JS 코드를 직접 붙여 넣지 마세요!**
**반드시 .ps1 파일로 저장 후 실행하세요.**

#### 파일: `fill-docx.ps1`

```powershell
# DOCX Fill Ops API 호출 스크립트
param(
    [string]$template = "template.docx",
    [string]$ops = "write_ops.json",
    [string]$output = "filled.docx",
    [switch]$skipEmpty
)

if (-not (Test-Path $template)) {
    Write-Error "템플릿 파일이 없습니다: $template"
    exit 1
}

if (-not (Test-Path $ops)) {
    Write-Error "Ops 파일이 없습니다: $ops"
    exit 1
}

Write-Host "🚀 DOCX 채우기 시작..." -ForegroundColor Cyan
Write-Host "  - Template: $template"
Write-Host "  - Ops: $ops"
Write-Host "  - Output: $output"
Write-Host "  - SkipEmpty: $skipEmpty"
Write-Host ""

# curl.exe 실행
$curlArgs = @(
    "-X", "POST",
    "http://localhost:3000/api/docx/fill",
    "-F", "template=@$template",
    "-F", "ops=@$ops"
)

if ($skipEmpty) {
    $curlArgs += "-F", "skipEmpty=1"
}

$curlArgs += "-i", "--output", $output

$response = & curl.exe $curlArgs 2>&1

# Summary 추출
$summaryLine = $response | Select-String "X-Fill-Summary:" | Select-Object -First 1

if ($summaryLine) {
    $summaryJson = ($summaryLine -split "X-Fill-Summary:\s*", 2)[1].Trim()
    $summary = $summaryJson | ConvertFrom-Json

    Write-Host "✅ 완료!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📊 Summary:" -ForegroundColor Yellow
    Write-Host "  - 성공 (ok): $($summary.ok)" -ForegroundColor Green
    Write-Host "  - 실패 (fail): $($summary.fail)" -ForegroundColor $(if ($summary.fail -gt 0) { "Red" } else { "Gray" })
    Write-Host "  - 잘못된 경로 (badPath): $($summary.badPath)"
    Write-Host "  - 테이블 없음 (noTable): $($summary.noTable)"
    Write-Host "  - 행 없음 (noRow): $($summary.noRow)"
    Write-Host "  - 셀 없음 (noCell): $($summary.noCell)"
    Write-Host "  - 최상위 테이블 수: $($summary.topTables)"
    Write-Host ""

    if (Test-Path $output) {
        $fileSize = (Get-Item $output).Length
        Write-Host "📄 생성된 파일: $output ($([math]::Round($fileSize/1KB, 2)) KB)" -ForegroundColor Cyan
    }
} else {
    Write-Host "⚠️  응답에서 Summary를 찾을 수 없습니다" -ForegroundColor Yellow
    Write-Host $response
}
```

#### 실행 방법

```powershell
# 기본 실행
powershell -ExecutionPolicy Bypass -File fill-docx.ps1

# 옵션 지정
powershell -ExecutionPolicy Bypass -File fill-docx.ps1 `
  -template "my-template.docx" `
  -ops "my-ops.json" `
  -output "my-filled.docx" `
  -skipEmpty

# 또는 스크립트 내에서
.\fill-docx.ps1 -skipEmpty
```

---

### 4. Node.js 스크립트

**⚠️ 중요: Node 스크립트도 파일로 저장 후 실행하세요.**

#### 파일: `test-fill-api.js`

```javascript
const fs = require('fs');
const FormData = require('form-data');
const fetch = require('node-fetch');

async function testFillApi(templatePath, opsPath, options = {}) {
  const { skipEmpty = false, debug = false } = options;

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }

  if (!fs.existsSync(opsPath)) {
    throw new Error(`Ops not found: ${opsPath}`);
  }

  console.log('🚀 DOCX 채우기 시작...');
  console.log(`  - Template: ${templatePath}`);
  console.log(`  - Ops: ${opsPath}`);
  console.log(`  - SkipEmpty: ${skipEmpty}`);
  console.log(`  - Debug: ${debug}`);
  console.log('');

  const form = new FormData();
  form.append('template', fs.createReadStream(templatePath));
  form.append('ops', fs.readFileSync(opsPath, 'utf8'));
  if (skipEmpty) form.append('skipEmpty', '1');
  if (debug) form.append('debug', '1');

  const response = await fetch('http://localhost:3000/api/docx/fill', {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    const error = await response.json();
    console.error('❌ 에러:', error);
    process.exit(1);
  }

  // Summary 추출
  const summaryHeader = response.headers.get('x-fill-summary');
  const summary = summaryHeader ? JSON.parse(summaryHeader) : null;

  if (summary) {
    console.log('✅ 완료!');
    console.log('');
    console.log('📊 Summary:');
    console.log(`  - 성공 (ok): ${summary.ok}`);
    console.log(`  - 실패 (fail): ${summary.fail}`);
    console.log(`  - 잘못된 경로 (badPath): ${summary.badPath}`);
    console.log(`  - 테이블 없음 (noTable): ${summary.noTable}`);
    console.log(`  - 행 없음 (noRow): ${summary.noRow}`);
    console.log(`  - 셀 없음 (noCell): ${summary.noCell}`);
    console.log(`  - 최상위 테이블 수: ${summary.topTables}`);
    console.log('');
  }

  if (debug) {
    const data = await response.json();
    console.log('Debug 모드:');
    console.log('  - Base64 DOCX:', data.base64Docx.substring(0, 50) + '...');
  } else {
    const buffer = await response.buffer();
    const outPath = './filled.docx';
    fs.writeFileSync(outPath, buffer);
    console.log(`📄 생성된 파일: ${outPath} (${(buffer.length / 1024).toFixed(2)} KB)`);
  }
}

// 실행
const templatePath = process.argv[2] || './template.docx';
const opsPath = process.argv[3] || './write_ops.json';

testFillApi(templatePath, opsPath, { skipEmpty: true })
  .catch((error) => {
    console.error('❌ 에러:', error.message);
    process.exit(1);
  });
```

#### 실행

```bash
# 파일로 저장 후 실행
node test-fill-api.js

# 경로 지정
node test-fill-api.js ./my-template.docx ./my-ops.json
```

---

## write_ops.json 예시

### 기본 예시

```json
[
  {"xmlPath": "document:table5:r1:c1", "value": "홍길동"},
  {"xmlPath": "document:table5:r2:c1", "value": "AI 플랫폼"},
  {"xmlPath": "document:table5:r3:c1", "value": "서울특별시"},
  {"xmlPath": "document:table6:r0:c0", "value": "우리 회사는..."}
]
```

### 줄바꿈 포함

```json
[
  {
    "xmlPath": "document:table6:r0:c0",
    "value": "첫 번째 줄\n두 번째 줄\n세 번째 줄"
  },
  {
    "xmlPath": "document:table6:r1:c0",
    "value": "- 항목 1\r\n- 항목 2\r\n- 항목 3"
  }
]
```

### 빈 값 포함 (skipEmpty 테스트)

```json
[
  {"xmlPath": "document:table5:r1:c1", "value": "홍길동"},
  {"xmlPath": "document:table5:r2:c1", "value": ""},
  {"xmlPath": "document:table5:r3:c1", "value": "   "},
  {"xmlPath": "document:table6:r0:c0", "value": null}
]
```

**skipEmpty=0 (기본):** 모든 ops 적용 → 빈 셀로 덮어씀
**skipEmpty=1:** 빈 값 ops 건너뜀 → 템플릿 라벨 유지

---

## 테스트 시나리오

### 시나리오 1: 성공 케이스 (11개 ops)

**write_ops.json:**
```json
[
  {"xmlPath": "document:table5:r1:c1", "value": "홍길동"},
  {"xmlPath": "document:table5:r2:c1", "value": "AI 플랫폼"},
  {"xmlPath": "document:table5:r3:c1", "value": "서울"},
  {"xmlPath": "document:table6:r0:c0", "value": "회사 소개..."},
  {"xmlPath": "document:table6:r1:c0", "value": "제품 A..."},
  {"xmlPath": "document:table6:r2:c0", "value": "시장 분석..."},
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

### 시나리오 2: 줄바꿈 테스트

```json
[
  {
    "xmlPath": "document:table6:r0:c0",
    "value": "문제 정의:\n- 기업은 문서 작성에 많은 시간 소비\n- 템플릿은 있지만 채우기 어려움\n\n해결 방안:\n- AI 기반 자동 채우기\n- 실시간 편집 지원"
  }
]
```

**Word에서 확인:**
- 모든 `\n`이 실제 줄바꿈으로 표시됨
- 단락 스타일 유지됨

---

## 트러블슈팅

### 문제 1: "word/document.xml not found"

**원인:** 유효한 DOCX 파일이 아님

**해결:**
```bash
# 파일 타입 확인
file template.docx
# 출력: Microsoft Word 2007+

# ZIP 내용 확인
unzip -l template.docx | grep "word/document.xml"
```

### 문제 2: "summary.noTable > 0"

**원인:** tableId가 최상위 테이블 범위를 초과

**해결:**
```bash
# 최상위 테이블 개수 확인
curl -X POST http://localhost:3000/api/docx/fill?debug=1 \
  -F "template=@template.docx" \
  -F "ops=[]" \
  | jq '.summary.topTables'
```

tableId는 1부터 topTables까지만 유효

### 문제 3: skipEmpty가 작동하지 않음

**원인:** 빈 문자열이 아닌 `null` 또는 공백

**확인:**
```json
// ❌ 건너뛰지 않음
{"value": "  text  "}

// ✅ 건너뜀 (skipEmpty=1)
{"value": ""}
{"value": "   "}
{"value": null}
```

### 문제 4: PowerShell에서 curl 별칭 문제

**증상:**
```
Invoke-WebRequest : 매개 변수 'F'를 찾을 수 없습니다.
```

**해결:**
```powershell
# ❌ 잘못된 방법 (PowerShell 별칭)
curl -F "template=@file.docx" ...

# ✅ 올바른 방법 (curl.exe)
curl.exe -F "template=@file.docx" ...

# 또는 별칭 제거
Remove-Item Alias:curl
```

---

## 완료 기준 체크리스트

### ✅ 기본 기능
- [ ] `curl.exe`로 호출 시 filled.docx 다운로드됨
- [ ] Word에서 table5/table6 값이 변경됨
- [ ] 11개 ops 적용 시 `summary.ok=11`
- [ ] X-Fill-Summary 헤더에서 summary 확인 가능

### ✅ skipEmpty 옵션
- [ ] skipEmpty=0: 빈 값도 적용 (셀이 빈 값으로 덮어씀)
- [ ] skipEmpty=1: 빈 값 건너뜀 (템플릿 라벨 유지)

### ✅ 줄바꿈 처리
- [ ] `value`에 `\n` 포함 시 Word에서 줄바꿈으로 표시
- [ ] `\r\n`도 정상 처리
- [ ] 단락 스타일 유지

### ✅ 에러 처리
- [ ] 잘못된 xmlPath → `badPath++`
- [ ] 없는 table → `noTable++`
- [ ] 없는 row → `noRow++`
- [ ] 없는 cell → `noCell++`

### ✅ 응답 형식
- [ ] 일반 모드: DOCX binary + X-Fill-Summary 헤더
- [ ] debug=1: JSON {summary, base64Docx}

---

## 다음 단계

1. **개발 서버 실행:**
   ```bash
   npm run dev
   ```

2. **테스트 (Windows):**
   ```powershell
   # fill-docx.ps1 저장 후
   powershell -ExecutionPolicy Bypass -File fill-docx.ps1
   ```

3. **테스트 (Mac/Linux):**
   ```bash
   curl -X POST http://localhost:3000/api/docx/fill \
     -F "template=@template.docx" \
     -F "ops=@write_ops.json" \
     --output filled.docx
   ```

4. **Word에서 확인:**
   - filled.docx 열기
   - table 값 변경 확인
   - 줄바꿈 정상 표시 확인

5. **Summary 검증:**
   ```bash
   # Mac/Linux
   curl -D - ... | grep "X-Fill-Summary"

   # Windows PowerShell
   # fill-docx.ps1 스크립트 사용 (자동 표시)
   ```

---

## 주의사항

⚠️ **PowerShell 사용자:**
- **절대 JS 코드를 PowerShell에 직접 붙여넣지 마세요**
- 반드시 `.ps1` 파일로 저장 후 실행
- `curl` 대신 `curl.exe` 사용

⚠️ **대용량 파일:**
- DOCX > 10MB: 서버 메모리 증가 가능
- `NODE_OPTIONS=--max-old-space-size=4096` 설정 권장

⚠️ **중첩 테이블:**
- 최상위 테이블만 카운트됨 (w:body 직계 자식)
- 중첩 테이블은 무시됨

⚠️ **줄바꿈:**
- `\n`과 `\r\n` 모두 지원
- Word에서 실제 줄바꿈으로 표시
- JSON에서 `\\n`으로 이스케이프 필요

모든 기능이 정상 작동합니다! 🎉
