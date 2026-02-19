"use client";

import React, { useState } from 'react';

/**
 * Content Control 기반 자동 채우기 테스트 컴포넌트
 *
 * 워크플로우:
 * 1. DOCX 업로드 → 분석 (슬롯 추출)
 * 2. 계측 (Content Control 삽입)
 * 3. OnlyOffice에서 열기
 * 4. 배치 채우기
 */
export default function ContentControlTest() {
  const [file, setFile] = useState<File | null>(null);
  const [slots, setSlots] = useState<any[]>([]);
  const [instrumentedFile, setInstrumentedFile] = useState<File | null>(null);
  const [documentKey, setDocumentKey] = useState<string>('');
  const [status, setStatus] = useState<string>('대기 중');

  // 1단계: 템플릿 분석
  const handleAnalyze = async () => {
    if (!file) {
      alert('파일을 선택하세요');
      return;
    }

    setStatus('분석 중...');
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/template/analyze', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(`분석 실패: ${response.statusText}`);
      }

      const data = await response.json();
      setSlots(data.slotSchema?.slots || []);
      setStatus(`분석 완료: ${data.slotSchema?.slots?.length || 0}개 슬롯 발견`);
      console.log('Slots:', data.slotSchema?.slots);
    } catch (error: any) {
      setStatus(`에러: ${error.message}`);
      console.error(error);
    }
  };

  // 2단계: Content Control 계측
  const handleInstrument = async () => {
    if (!file || slots.length === 0) {
      alert('먼저 템플릿을 분석하세요');
      return;
    }

    setStatus('계측 중...');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const docxBase64 = buffer.toString('base64');

      const response = await fetch('/api/template/instrument', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docxBase64: docxBase64,
          slots: slots
        })
      });

      if (!response.ok) {
        throw new Error(`계측 실패: ${response.statusText}`);
      }

      const blob = await response.blob();
      const instrumentedFile = new File([blob], 'instrumented.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });

      setInstrumentedFile(instrumentedFile);

      const insertedCount = response.headers.get('X-Inserted-Count');
      const skippedCount = response.headers.get('X-Skipped-Count');
      setStatus(`계측 완료: ${insertedCount}개 삽입, ${skippedCount}개 스킵`);

      // 자동 다운로드
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'instrumented.docx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      setStatus(`에러: ${error.message}`);
      console.error(error);
    }
  };

  // 3단계: OnlyOffice에 업로드
  const handleUpload = async () => {
    if (!instrumentedFile) {
      alert('먼저 계측을 완료하세요');
      return;
    }

    setStatus('업로드 중...');
    const formData = new FormData();
    formData.append('file', instrumentedFile);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(`업로드 실패: ${response.statusText}`);
      }

      const data = await response.json();
      setDocumentKey(data.fileId);
      setStatus(`업로드 완료: ${data.fileId}`);

      // OnlyOffice 에디터 열기
      window.open(`/editor?fileId=${data.fileId}`, '_blank');
    } catch (error: any) {
      setStatus(`에러: ${error.message}`);
      console.error(error);
    }
  };

  // 4단계: 배치 채우기
  const handleFill = async () => {
    if (!documentKey) {
      alert('먼저 문서를 업로드하고 OnlyOffice에서 여세요');
      return;
    }

    setStatus('채우기 중...');

    // 예시 데이터 생성
    const fills = slots.slice(0, 5).map((slot, idx) => ({
      slot_id: slot.slot_id,
      value: `테스트 값 ${idx + 1}\n이것은 ${slot.label}입니다.`
    }));

    try {
      const response = await fetch('/api/realtime/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentKey: documentKey,
          patch: {
            op: 'batchFill',
            fills: fills
          }
        })
      });

      if (!response.ok) {
        throw new Error(`채우기 실패: ${response.statusText}`);
      }

      setStatus(`채우기 완료: ${fills.length}개 전송`);
      console.log('Fills sent:', fills);
    } catch (error: any) {
      setStatus(`에러: ${error.message}`);
      console.error(error);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Content Control 자동 채우기 테스트</h1>

      <div style={{ marginBottom: '20px', padding: '10px', backgroundColor: '#f0f0f0', borderRadius: '4px' }}>
        <strong>상태:</strong> {status}
      </div>

      {/* 1단계: 파일 선택 */}
      <div style={{ marginBottom: '20px' }}>
        <h3>1단계: DOCX 템플릿 선택</h3>
        <input
          type="file"
          accept=".docx"
          onChange={(e) => {
            const selectedFile = e.target.files?.[0];
            if (selectedFile) {
              setFile(selectedFile);
              setStatus(`파일 선택됨: ${selectedFile.name}`);
            }
          }}
        />
      </div>

      {/* 2단계: 분석 */}
      <div style={{ marginBottom: '20px' }}>
        <h3>2단계: 템플릿 분석 (슬롯 추출)</h3>
        <button
          onClick={handleAnalyze}
          disabled={!file}
          style={{
            padding: '10px 20px',
            backgroundColor: file ? '#4CAF50' : '#ccc',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: file ? 'pointer' : 'not-allowed'
          }}
        >
          분석 시작
        </button>
        {slots.length > 0 && (
          <div style={{ marginTop: '10px', fontSize: '14px' }}>
            <strong>발견된 슬롯:</strong> {slots.length}개
            <details style={{ marginTop: '5px' }}>
              <summary>슬롯 목록 보기</summary>
              <pre style={{ fontSize: '12px', overflow: 'auto', maxHeight: '200px' }}>
                {JSON.stringify(slots.slice(0, 10), null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>

      {/* 3단계: 계측 */}
      <div style={{ marginBottom: '20px' }}>
        <h3>3단계: Content Control 계측</h3>
        <button
          onClick={handleInstrument}
          disabled={slots.length === 0}
          style={{
            padding: '10px 20px',
            backgroundColor: slots.length > 0 ? '#2196F3' : '#ccc',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: slots.length > 0 ? 'pointer' : 'not-allowed'
          }}
        >
          계측 시작 (CC 삽입)
        </button>
        {instrumentedFile && (
          <div style={{ marginTop: '10px', fontSize: '14px', color: 'green' }}>
            ✓ 계측 완료! instrumented.docx 다운로드됨
          </div>
        )}
      </div>

      {/* 4단계: 업로드 */}
      <div style={{ marginBottom: '20px' }}>
        <h3>4단계: OnlyOffice에 업로드</h3>
        <button
          onClick={handleUpload}
          disabled={!instrumentedFile}
          style={{
            padding: '10px 20px',
            backgroundColor: instrumentedFile ? '#FF9800' : '#ccc',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: instrumentedFile ? 'pointer' : 'not-allowed'
          }}
        >
          업로드 및 열기
        </button>
        {documentKey && (
          <div style={{ marginTop: '10px', fontSize: '14px' }}>
            <strong>Document Key:</strong> {documentKey}
          </div>
        )}
      </div>

      {/* 5단계: 채우기 */}
      <div style={{ marginBottom: '20px' }}>
        <h3>5단계: 배치 채우기 (테스트)</h3>
        <button
          onClick={handleFill}
          disabled={!documentKey}
          style={{
            padding: '10px 20px',
            backgroundColor: documentKey ? '#9C27B0' : '#ccc',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: documentKey ? 'pointer' : 'not-allowed'
          }}
        >
          테스트 데이터로 채우기
        </button>
        <div style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>
          처음 5개 슬롯에 테스트 값을 채웁니다.
        </div>
      </div>

      {/* 안내 */}
      <div style={{ marginTop: '40px', padding: '15px', backgroundColor: '#e3f2fd', borderRadius: '4px' }}>
        <h4>💡 사용 방법</h4>
        <ol style={{ fontSize: '14px', lineHeight: '1.8' }}>
          <li>DOCX 템플릿 파일을 선택합니다.</li>
          <li>"분석 시작"을 클릭하여 채울 수 있는 슬롯을 추출합니다.</li>
          <li>"계측 시작"을 클릭하여 Content Control을 삽입합니다.</li>
          <li>"업로드 및 열기"를 클릭하면 OnlyOffice 에디터가 열립니다.</li>
          <li>OnlyOffice 콘솔에서 다음 명령어로 CC 확인:
            <pre style={{ fontSize: '12px', backgroundColor: '#fff', padding: '5px', marginTop: '5px' }}>
{`Api.GetDocument().GetAllContentControls().map(cc => cc.GetTag())`}
            </pre>
          </li>
          <li>"테스트 데이터로 채우기"를 클릭하면 자동으로 값이 채워집니다.</li>
        </ol>
      </div>
    </div>
  );
}
