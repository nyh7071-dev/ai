// POST /api/docx/debug
// DOCX 파일의 XML 구조를 분석하여 디버깅 정보 제공

import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";

export async function POST(req: NextRequest) {
  console.log("[DOCX Debug] API 호출됨");

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "파일이 없습니다" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file("word/document.xml")?.async("string");

    if (!documentXml) {
      return NextResponse.json({ error: "document.xml을 찾을 수 없습니다" }, { status: 400 });
    }

    // 테이블 구조 분석
    const tables: any[] = [];
    const tableRegex = /<w:tbl[^>]*>([\s\S]*?)<\/w:tbl>/g;
    let tableMatch;
    let tableIndex = 0;

    while ((tableMatch = tableRegex.exec(documentXml)) !== null) {
      tableIndex++;
      const tableContent = tableMatch[0];
      const tableStart = tableMatch.index;

      // 행 분석
      const rows: any[] = [];
      const rowRegex = /<w:tr[^>]*>([\s\S]*?)<\/w:tr>/g;
      let rowMatch;
      let rowIndex = 0;

      while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
        rowIndex++;
        const rowContent = rowMatch[0];

        // 셀 분석
        const cells: any[] = [];
        const cellRegex = /<w:tc[^>]*>([\s\S]*?)<\/w:tc>/g;
        let cellMatch;

        while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
          const cellContent = cellMatch[0];

          // 셀 내 텍스트 추출
          const textParts: string[] = [];
          const textRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
          let textMatch;

          while ((textMatch = textRegex.exec(cellContent)) !== null) {
            if (textMatch[1]) {
              textParts.push(textMatch[1]);
            }
          }

          const fullText = textParts.join('');
          if (fullText.trim()) {
            cells.push({
              textParts,
              fullText: fullText.substring(0, 100) + (fullText.length > 100 ? '...' : ''),
              hasPlaceholder: fullText.includes('※') || fullText.includes('ㅇ') || /O{3,}/.test(fullText)
            });
          }
        }

        if (cells.length > 0) {
          rows.push({
            rowIndex,
            cells
          });
        }
      }

      if (rows.length > 0) {
        tables.push({
          tableIndex,
          position: tableStart,
          rowCount: rows.length,
          rows: rows.slice(0, 10) // 처음 10행만
        });
      }
    }

    // 주요 라벨 검색
    const labelsToFind = [
      "명칭", "범주", "아이템 개요", "문제 인식", "실현 가능성",
      "성장전략", "팀 구성", "Problem", "Solution", "Scale-up", "Team"
    ];

    const labelPositions: any[] = [];

    for (const label of labelsToFind) {
      // 직접 검색
      let pos = documentXml.indexOf(label);
      if (pos !== -1) {
        // 주변 컨텍스트 추출
        const start = Math.max(0, pos - 50);
        const end = Math.min(documentXml.length, pos + label.length + 100);
        const context = documentXml.substring(start, end);

        // XML 태그 제거하고 텍스트만 추출
        const textOnly = context.replace(/<[^>]+>/g, '').substring(0, 100);

        labelPositions.push({
          label,
          found: true,
          position: pos,
          context: textOnly
        });
      } else {
        labelPositions.push({
          label,
          found: false
        });
      }
    }

    // 플레이스홀더 패턴 검색
    const placeholderPatterns = [
      { pattern: /※[^<]{0,50}/g, name: "※ 예시" },
      { pattern: /ㅇ\s/g, name: "ㅇ 글머리" },
      { pattern: /O{3,}/g, name: "OOOOO" },
    ];

    const placeholders: any[] = [];

    for (const { pattern, name } of placeholderPatterns) {
      const matches = documentXml.match(pattern);
      if (matches) {
        placeholders.push({
          type: name,
          count: matches.length,
          samples: matches.slice(0, 5).map(m => m.substring(0, 50))
        });
      }
    }

    return NextResponse.json({
      totalLength: documentXml.length,
      tableCount: tables.length,
      tables: tables.slice(0, 5), // 처음 5개 테이블만
      labelPositions,
      placeholders
    });

  } catch (error: any) {
    console.error("[DOCX Debug] 에러:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
