"use client";

import React, { useState } from 'react';

/**
 * DOCX Fill Ops API 테스트 컴포넌트
 *
 * 사용법:
 * 1. Template DOCX 파일 선택
 * 2. Ops JSON 입력 또는 파일 업로드
 * 3. "채우기 실행" 클릭
 * 4. filled.docx 자동 다운로드
 */
export default function FillDocxTest() {
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [opsText, setOpsText] = useState(
    JSON.stringify([
      { xmlPath: "document:table5:r1:c1", value: "홍길동", key: "name" },
      { xmlPath: "document:table5:r2:c1", value: "AI 플랫폼", key: "product" },
      { xmlPath: "document:table6:r0:c0", value: "우리 회사는 AI 기반...", key: "intro" },
    ], null, 2)
  );
  const [skipEmpty, setSkipEmpty] = useState(true);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSummary(null);

    if (!templateFile) {
      setError('템플릿 파일을 선택하세요');
      return;
    }

    let ops: any[];
    try {
      ops = JSON.parse(opsText);
      if (!Array.isArray(ops)) {
        throw new Error('ops는 배열이어야 합니다');
      }
    } catch (err: any) {
      setError(`Ops JSON 파싱 실패: ${err.message}`);
      return;
    }

    setLoading(true);

    try {
      const formData = new FormData();
      formData.append('template', templateFile);
      formData.append('ops', JSON.stringify(ops));
      if (skipEmpty) formData.append('skipEmpty', '1');

      const response = await fetch('/api/docx/fill-ops', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      // Summary 추출
      const summaryHeader = response.headers.get('X-Fill-Summary');
      if (summaryHeader) {
        setSummary(JSON.parse(summaryHeader));
      }

      // 파일 다운로드
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'filled.docx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setError('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h1>DOCX Fill Ops 테스트</h1>

      <form onSubmit={handleSubmit}>
        {/* Template 파일 */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px' }}>
            1. Template DOCX 파일:
          </label>
          <input
            type="file"
            accept=".docx"
            onChange={(e) => setTemplateFile(e.target.files?.[0] || null)}
            required
          />
          {templateFile && (
            <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
              선택됨: {templateFile.name} ({(templateFile.size / 1024).toFixed(1)} KB)
            </div>
          )}
        </div>

        {/* Ops JSON */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px' }}>
            2. Ops JSON:
          </label>
          <textarea
            value={opsText}
            onChange={(e) => setOpsText(e.target.value)}
            rows={15}
            style={{
              width: '100%',
              fontFamily: 'monospace',
              fontSize: '12px',
              padding: '10px',
              border: '1px solid #ccc',
              borderRadius: '4px',
            }}
            required
          />
          <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
            xmlPath 형식: document:table{'{'}n{'}'}:r{'{'}row{'}'}:c{'{'}col{'}'} (tableId는 1-based)
          </div>
        </div>

        {/* skipEmpty 옵션 */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'flex', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={skipEmpty}
              onChange={(e) => setSkipEmpty(e.target.checked)}
              style={{ marginRight: '8px' }}
            />
            <span>빈 값 건너뛰기 (skipEmpty)</span>
          </label>
          <div style={{ fontSize: '12px', color: '#666', marginLeft: '24px', marginTop: '5px' }}>
            체크 시: value가 빈 문자열/공백인 ops는 적용하지 않음 (템플릿 라벨 유지)
          </div>
        </div>

        {/* 제출 버튼 */}
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '12px 24px',
            fontSize: '16px',
            fontWeight: 'bold',
            backgroundColor: loading ? '#ccc' : '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? '처리 중...' : '채우기 실행'}
        </button>
      </form>

      {/* 에러 표시 */}
      {error && (
        <div style={{
          marginTop: '20px',
          padding: '15px',
          backgroundColor: '#ffebee',
          border: '1px solid #f44336',
          borderRadius: '4px',
          color: '#c62828',
        }}>
          <strong>⚠️ 에러:</strong> {error}
        </div>
      )}

      {/* Summary 표시 */}
      {summary && (
        <div style={{
          marginTop: '20px',
          padding: '15px',
          backgroundColor: '#e8f5e9',
          border: '1px solid #4CAF50',
          borderRadius: '4px',
        }}>
          <h3 style={{ marginTop: 0 }}>✅ 완료</h3>
          <table style={{ width: '100%', fontSize: '14px' }}>
            <tbody>
              <tr>
                <td style={{ padding: '5px', fontWeight: 'bold' }}>성공 (ok):</td>
                <td style={{ padding: '5px' }}>{summary.ok}</td>
              </tr>
              <tr>
                <td style={{ padding: '5px', fontWeight: 'bold' }}>실패 (fail):</td>
                <td style={{ padding: '5px' }}>{summary.fail}</td>
              </tr>
              <tr>
                <td style={{ padding: '5px', fontWeight: 'bold' }}>잘못된 경로 (badPath):</td>
                <td style={{ padding: '5px' }}>{summary.badPath}</td>
              </tr>
              <tr>
                <td style={{ padding: '5px', fontWeight: 'bold' }}>테이블 없음 (noTable):</td>
                <td style={{ padding: '5px' }}>{summary.noTable}</td>
              </tr>
              <tr>
                <td style={{ padding: '5px', fontWeight: 'bold' }}>행 없음 (noRow):</td>
                <td style={{ padding: '5px' }}>{summary.noRow}</td>
              </tr>
              <tr>
                <td style={{ padding: '5px', fontWeight: 'bold' }}>셀 없음 (noCell):</td>
                <td style={{ padding: '5px' }}>{summary.noCell}</td>
              </tr>
              <tr>
                <td style={{ padding: '5px', fontWeight: 'bold' }}>최상위 테이블 수:</td>
                <td style={{ padding: '5px' }}>{summary.topTables}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* 사용 안내 */}
      <div style={{
        marginTop: '40px',
        padding: '15px',
        backgroundColor: '#e3f2fd',
        borderRadius: '4px',
      }}>
        <h4 style={{ marginTop: 0 }}>💡 사용 방법</h4>
        <ol style={{ fontSize: '14px', lineHeight: '1.8' }}>
          <li>DOCX 템플릿 파일을 선택합니다.</li>
          <li>Ops JSON을 입력하거나 수정합니다.
            <ul>
              <li><code>xmlPath</code>: document:table5:r1:c1 형식 (table은 1-based, row/col은 0-based)</li>
              <li><code>value</code>: 채울 값</li>
            </ul>
          </li>
          <li>"채우기 실행"을 클릭하면 자동으로 filled.docx가 다운로드됩니다.</li>
          <li>Summary를 확인하여 성공/실패 통계를 볼 수 있습니다.</li>
        </ol>

        <h4>curl 예시:</h4>
        <pre style={{
          backgroundColor: '#263238',
          color: '#aed581',
          padding: '10px',
          borderRadius: '4px',
          fontSize: '12px',
          overflow: 'auto',
        }}>
{`curl -X POST http://localhost:3000/api/docx/fill-ops \\
  -F "template=@./template.docx" \\
  -F "ops=@./write_ops.json" \\
  -F "skipEmpty=1" \\
  --output filled.docx`}
        </pre>
      </div>
    </div>
  );
}
