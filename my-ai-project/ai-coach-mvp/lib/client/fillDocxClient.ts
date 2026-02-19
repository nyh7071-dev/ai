/**
 * 클라이언트에서 DOCX 채우기 API 호출
 *
 * @example
 * const file = new File([...], 'template.docx');
 * const ops = [{ xmlPath: "document:table5:r1:c1", value: "홍길동" }];
 * await fillDocxClient(file, ops, { skipEmpty: true });
 */

import { useState } from 'react';

export interface FillDocxClientOptions {
  skipEmpty?: boolean;
  debug?: boolean;
  onProgress?: (message: string) => void;
}

export interface FillSummary {
  ok: number;
  fail: number;
  badPath: number;
  noTable: number;
  noRow: number;
  noCell: number;
  topTables: number;
}

/**
 * DOCX 채우기 API 호출 (파일 다운로드)
 */
export async function fillDocxClient(
  templateFile: File,
  ops: any[],
  options: FillDocxClientOptions = {}
): Promise<{ summary: FillSummary; blob?: Blob; base64?: string }> {
  const { skipEmpty = false, debug = false, onProgress } = options;

  onProgress?.('FormData 생성 중...');

  const formData = new FormData();
  formData.append('template', templateFile);
  formData.append('ops', JSON.stringify(ops));
  if (skipEmpty) formData.append('skipEmpty', '1');
  if (debug) formData.append('debug', '1');

  onProgress?.('서버 요청 중...');

  const response = await fetch('/api/docx/fill-ops', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  // Summary 추출 (헤더)
  const summaryHeader = response.headers.get('X-Fill-Summary');
  const summary: FillSummary = summaryHeader
    ? JSON.parse(summaryHeader)
    : { ok: 0, fail: 0, badPath: 0, noTable: 0, noRow: 0, noCell: 0, topTables: 0 };

  if (debug) {
    // Debug 모드: JSON 응답
    const data = await response.json();
    onProgress?.('완료 (Debug 모드)');
    return {
      summary: data.summary,
      base64: data.base64Docx,
    };
  } else {
    // 일반 모드: DOCX 다운로드
    const blob = await response.blob();
    onProgress?.('다운로드 중...');

    // 파일 다운로드
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'filled.docx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    onProgress?.('완료');

    return { summary, blob };
  }
}

/**
 * React 컴포넌트에서 사용 예시
 */
export function useFillDocx() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [summary, setSummary] = useState<FillSummary | null>(null);

  const fillDocx = async (templateFile: File, ops: any[], options?: FillDocxClientOptions) => {
    setLoading(true);
    setProgress('시작...');

    try {
      const result = await fillDocxClient(templateFile, ops, {
        ...options,
        onProgress: setProgress,
      });

      setSummary(result.summary);
      setProgress('');
      return result;
    } catch (error: any) {
      setProgress('');
      throw error;
    } finally {
      setLoading(false);
    }
  };

  return { fillDocx, loading, progress, summary };
}
