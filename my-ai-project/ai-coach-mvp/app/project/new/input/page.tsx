'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function InputPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateId = searchParams.get('templateId');

  const [formData, setFormData] = useState({ subject: '', assertion: '', keywords: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
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

      alert("정보가 저장되었습니다!");
      // 다음 화면으로 projectId를 들고 이동!
      router.push(`/project/new/upload?projectId=${data.id}`);
    } catch (err: any) {
      alert("에러 발생: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8 text-black">
      <div className="max-w-2xl mx-auto bg-white p-8 rounded-2xl shadow-sm border border-gray-200">
        <h1 className="text-2xl font-bold mb-6">🖋️ 과제 내용 입력</h1>
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
            {loading ? '저장 중...' : '다음 단계로 이동 →'}
          </button>
        </form>
      </div>
    </div>
  );
}