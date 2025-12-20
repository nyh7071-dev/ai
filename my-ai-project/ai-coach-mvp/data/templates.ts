export interface Template {
    id: string;
    name: string;
    description: string;
    schema: {
        sectionKeys: string[];
    };
}

export const builtInTemplates: Template[] = [
    {
        id: 'report_basic',
        name: '교양 레포트 (서론-본론-결론)',
        description: '일반적인 대학 레포트 양식입니다. 주장과 근거 제시가 중요합니다.',
        schema: { sectionKeys: ['서론', '본론', '결론', '참고문헌'] },
    },
    {
        id: 'lab_report',
        name: '실험 보고서',
        description: '이공계 실험 과목 보고서 양식입니다. 결과 및 고찰이 중요합니다.',
        schema: { sectionKeys: ['실험목적', '과정', '결과', '고찰'] },
    },
    {
        id: 'lit_review',
        name: '문헌 고찰',
        description: '특정 주제에 대한 선행 연구 동향을 정리하는 양식입니다.',
        schema: { sectionKeys: ['개요', '연구현황', '종합비판', '결론'] },
    },
];