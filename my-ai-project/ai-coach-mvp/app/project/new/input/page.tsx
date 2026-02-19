'use client';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function InputPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 p-8 flex items-center justify-center">로딩 중...</div>}>
      <InputPageContent />
    </Suspense>
  );
}

function InputPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateId = searchParams.get('templateId');

  const [formData, setFormData] = useState({ subject: '', assertion: '', keywords: '' });
  const [loading, setLoading] = useState(false);
  const [hasSavedDraft, setHasSavedDraft] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem('repot-input-draft');
    setHasSavedDraft(Boolean(saved));
  }, []);

  const loadPreviousData = () => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem('repot-input-draft');
    if (!saved) {
      alert('이전에 저장된 데이터가 없습니다.');
      return;
    }
    try {
      const parsed = JSON.parse(saved) as { subject: string; assertion: string; keywords: string };
      setFormData({
        subject: parsed.subject || '',
        assertion: parsed.assertion || '',
        keywords: parsed.keywords || '',
      });
    } catch (err) {
      console.error(err);
      alert('이전 데이터를 불러오는 데 실패했습니다.');
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Supabase에 저장하고 ID를 받아옴
      const { data, error } = await supabase
        .from('project')
        .insert([{
          template_id: templateId,
          subject: formData.subject,
          assertion: formData.assertion,
          keywords: formData.keywords,
          title: formData.subject
        }])
        .select().single();

      if (error) throw error;

      if (typeof window !== 'undefined') {
        window.localStorage.setItem('repot-input-draft', JSON.stringify(formData));
        setHasSavedDraft(true);
      }

      alert("정보가 저장되었습니다!");
      // 다음 화면으로 projectId를 들고 이동!
      router.push(`/project/new/upload?projectId=${data.id}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.";
      alert("에러 발생: " + message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8 text-black">
      <div className="max-w-2xl mx-auto bg-white p-8 rounded-2xl shadow-sm border border-gray-200">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">과제 내용 입력</h1>
          <button
            type="button"
            onClick={loadPreviousData}
            disabled={!hasSavedDraft || loading}
            className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
          >
            이전 데이터 불러오기
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-bold mb-2">과제 주제</label>
            <input required className="w-full border p-3 rounded-lg" onChange={(e)=>setFormData({...formData, subject: e.target.value})} />
          </div>
          <div>
            <label className="block text-sm font-bold mb-2">내 핵심 주장</label>
            <textarea required className="w-full border p-3 rounded-lg h-32" onChange={(e)=>setFormData({...formData, assertion: e.target.value})} />
          </div>
          <div>
            <label className="block text-sm font-bold mb-2">키워드 (쉼표 구분)</label>
            <input required className="w-full border p-3 rounded-lg" onChange={(e)=>setFormData({...formData, keywords: e.target.value})} />
          </div>
          <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold">
            {loading ? '저장 중...' : '다음 단계로 이동'}
          </button>
        </form>
      </div>
    </div>
  );
}
