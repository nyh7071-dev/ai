# DOCX 서버 사이드 채우기 구현 요약

## 변경사항

### 1. 새로 추가된 파일

#### `app/api/docx/fill/route.ts` (NEW)
- **기능**: docxtemplater로 DOCX 템플릿에 값을 채워 새 파일 생성
- **입력**:
  - `template`: File (DOCX 템플릿 파일)
  - `values`: JSON string (예: `{"TITLE": "제목", "ABSTRACT": "요약"}`)
- **출력**:
  ```json
  {
    "ok": true,
    "fileUrl": "http://host.docker.internal:3000/filled/filled_1234567890.docx",
    "key": "filled_1234567890",
    "fileName": "filled_1234567890.docx"
  }
  ```
- **저장 위치**: `public/filled/filled_{timestamp}.docx`

### 2. 수정된 파일

#### `components/OnlyOfficeEditor.tsx` (MAJOR CHANGES)
**제거된 기능:**
- ❌ 플러그인 주입 코드 (`editorConfig.plugins`)
- ❌ postMessage 리스너
- ❌ 플러그인 디버그 패널
- ❌ 플러그인 polling 로직
- ❌ `pluginWindowRef`, `pluginDebugInfo` state

**추가된 기능:**
- ✅ `forwardRef` + `useImperativeHandle`로 ref 지원
- ✅ `reloadDocument(newFileUrl, newKey, newFileName?)` 메서드
  - 기존 DocEditor destroy
  - 새 fileUrl/key로 DocEditor 재생성
  - 300ms 딜레이로 안정적 전환

**타입 정의:**
```typescript
export interface OnlyOfficeEditorRef {
  reloadDocument: (newFileUrl: string, newKey: string, newFileName?: string) => void;
}
```

**핵심 변경:**
- `plugins: false` (line 139)
- `reloadDocument` 함수 (lines 173-201)
- `forwardRef` 패턴 (line 29)

### 3. 생성된 디렉토리

#### `public/filled/` (NEW)
- 채워진 DOCX 파일 저장 위치
- DocumentServer가 `http://host.docker.internal:3000/filled/xxx.docx`로 접근 가능

---

## 사용 방법

### result page에서 통합

```tsx
import OnlyOfficeEditor, { OnlyOfficeEditorRef } from "@/components/OnlyOfficeEditor";
import { useRef } from "react";

export default function ResultPage() {
  const editorRef = useRef<OnlyOfficeEditorRef>(null);

  const handleFillDocument = async () => {
    try {
      // 1. 템플릿 파일 준비 (예시)
      const templateResponse = await fetch("/templates/report.docx");
      const templateBlob = await templateResponse.blob();

      // 2. FormData 생성
      const formData = new FormData();
      formData.append("template", templateBlob, "template.docx");
      formData.append("values", JSON.stringify({
        TITLE: "AI 생성 제목",
        ABSTRACT: "AI 생성 요약",
        // 추가 placeholder...
      }));

      // 3. API 호출
      const response = await fetch("/api/docx/fill", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (result.ok) {
        console.log("✅ Document filled:", result);

        // 4. 에디터 재로드
        if (editorRef.current) {
          editorRef.current.reloadDocument(
            result.fileUrl,
            result.key,
            result.fileName
          );
        }
      } else {
        console.error("❌ Fill failed:", result.error);
      }
    } catch (error) {
      console.error("❌ Fill error:", error);
    }
  };

  return (
    <div>
      <button onClick={handleFillDocument}>
        AI 내용 채우기
      </button>

      <OnlyOfficeEditor
        ref={editorRef}
        fileId="initial-doc-id"
        fileName="document.docx"
      />
    </div>
  );
}
```

---

## 테스트 스펙

### 최소 템플릿 예시
템플릿 DOCX에 다음 placeholder 포함:
```
제목: {{TITLE}}
요약: {{ABSTRACT}}
```

### 테스트 values
```json
{
  "TITLE": "테스트 제목",
  "ABSTRACT": "테스트 요약"
}
```

### 예상 동작
1. **버튼 클릭** → API 호출
2. **서버**: 템플릿 로드 → 값 채우기 → `public/filled/` 저장
3. **API 응답**: `fileUrl`, `key` 반환
4. **프론트**: `editorRef.current.reloadDocument()` 호출
5. **결과**: 편집기에 채워진 문서가 즉시 표시됨

---

## 핵심 차이점

### 이전 (플러그인 방식)
- ONLYOFFICE 플러그인으로 Content Control 직접 조작
- postMessage로 통신
- 복잡한 iframe 계층 구조
- 캐시/경로 이슈 다수

### 현재 (서버 사이드 방식)
- docxtemplater로 서버에서 DOCX 생성
- 단순한 파일 교체 (destroy → create)
- 안정적이고 빠름
- 플러그인 없이 순수 DocumentServer 기능만 사용

---

## 디버그 정보

### 콘솔 로그 확인
```javascript
// 성공 케이스:
[CREATE] DocEditor created successfully
[RELOAD] Destroying existing editor...
[RELOAD] Creating new editor with new document...
[EDITOR] onDocumentReady fired ✅
```

### API 응답 확인
```bash
curl -X POST http://localhost:3000/api/docx/fill \
  -F "template=@template.docx" \
  -F 'values={"TITLE":"Test"}'
```

---

## 필요한 패키지 (이미 설치됨)
- ✅ `docxtemplater@3.67.6`
- ✅ `pizzip@3.2.0`

---

## 파일 목록

### 신규 파일
1. `app/api/docx/fill/route.ts` - DOCX 채우기 API
2. `public/filled/` - 생성된 파일 저장 디렉토리
3. `IMPLEMENTATION_SUMMARY.md` - 이 문서

### 수정된 파일
1. `components/OnlyOfficeEditor.tsx` - 플러그인 제거, reload 기능 추가

### 변경 없음
- `app/project/new/result/page.tsx` - 통합 작업 필요
- `templates/report.docx` - 기존 템플릿 사용 가능
