// DOCX → Document IR 파서
// DOCX XML을 구조화된 IR로 변환

import JSZip from 'jszip';
import { v4 as uuidv4 } from 'uuid';
import {
  DocumentIR,
  Block,
  ParagraphBlock,
  HeadingBlock,
  TableBlock,
  TableRow,
  TableCell,
  TextRun,
  Anchor,
} from './types';

export class DocxParser {
  private xml: string = '';
  private blockIndex: number = 0;

  async parse(buffer: Buffer): Promise<DocumentIR> {
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file('word/document.xml')?.async('string');

    if (!documentXml) {
      throw new Error('document.xml을 찾을 수 없습니다');
    }

    this.xml = documentXml;
    this.blockIndex = 0;

    const blocks = this.parseBody();
    const anchors = this.extractAnchors(blocks);

    return {
      doc_id: uuidv4(),
      format: 'docx',
      metadata: {
        // TODO: 메타데이터 파싱
      },
      blocks,
      anchors,
    };
  }

  private parseBody(): Block[] {
    const blocks: Block[] = [];

    // <w:body> 내용 추출
    const bodyMatch = this.xml.match(/<w:body[^>]*>([\s\S]*)<\/w:body>/);
    if (!bodyMatch) return blocks;

    const bodyContent = bodyMatch[1];
    let pos = 0;
    let iterations = 0;
    const maxIterations = 10000; // 무한루프 방지

    while (pos < bodyContent.length && iterations < maxIterations) {
      iterations++;

      // 테이블 찾기
      const tableStart = bodyContent.indexOf('<w:tbl', pos);
      const paraStart = bodyContent.indexOf('<w:p ', pos);
      const paraStart2 = bodyContent.indexOf('<w:p>', pos);
      const nextPara = paraStart === -1 ? paraStart2 : (paraStart2 === -1 ? paraStart : Math.min(paraStart, paraStart2));

      // 더 이상 찾을 게 없으면 종료
      if (tableStart === -1 && nextPara === -1) break;

      if (tableStart !== -1 && (nextPara === -1 || tableStart < nextPara)) {
        // 테이블 파싱
        const tableEnd = this.findClosingTag(bodyContent, tableStart, 'w:tbl');
        if (tableEnd !== -1) {
          const tableXml = bodyContent.substring(tableStart, tableEnd);
          const tableBlock = this.parseTable(tableXml, tableStart + bodyMatch.index! + '<w:body>'.length);
          if (tableBlock) blocks.push(tableBlock);
          pos = tableEnd;
          continue;
        } else {
          // 닫는 태그를 찾지 못하면 건너뛰기
          pos = tableStart + 6; // '<w:tbl'.length
          continue;
        }
      }

      if (nextPara !== -1) {
        // 문단 파싱
        const paraEnd = this.findClosingTag(bodyContent, nextPara, 'w:p');
        if (paraEnd !== -1) {
          const paraXml = bodyContent.substring(nextPara, paraEnd);
          const paraBlock = this.parseParagraph(paraXml, nextPara + bodyMatch.index! + '<w:body>'.length);
          if (paraBlock) blocks.push(paraBlock);
          pos = paraEnd;
          continue;
        } else {
          // 닫는 태그를 찾지 못하면 건너뛰기
          pos = nextPara + 4; // '<w:p'.length
          continue;
        }
      }

      pos++;
    }

    if (iterations >= maxIterations) {
      console.warn('[DocxParser] 최대 반복 횟수 도달, 파싱 중단');
    }

    return blocks;
  }

  private findClosingTag(xml: string, startPos: number, tagName: string): number {
    let depth = 0;
    let pos = startPos;

    while (pos < xml.length) {
      const openTag = xml.indexOf(`<${tagName}`, pos);
      const closeTag = xml.indexOf(`</${tagName}>`, pos);

      if (closeTag === -1) return -1;

      if (openTag !== -1 && openTag < closeTag) {
        // 여는 태그가 먼저 나옴
        depth++;
        pos = openTag + tagName.length + 1;
      } else {
        // 닫는 태그가 먼저 나옴
        if (depth === 0) {
          return closeTag + `</${tagName}>`.length;
        }
        depth--;
        pos = closeTag + `</${tagName}>`.length;
      }
    }

    return -1;
  }

  private parseParagraph(paraXml: string, xmlStart: number): ParagraphBlock | HeadingBlock | null {
    const runs = this.parseRuns(paraXml, xmlStart);
    const text = runs.map(r => r.text).join('');

    if (!text.trim()) return null;

    const blockId = `b${++this.blockIndex}`;

    // 제목 스타일 확인
    const styleMatch = paraXml.match(/<w:pStyle[^>]*w:val="([^"]+)"/);
    const styleName = styleMatch?.[1] || '';

    if (styleName.match(/Heading|제목|Title/i)) {
      const levelMatch = styleName.match(/(\d)/);
      const level = levelMatch ? Math.min(6, Math.max(1, parseInt(levelMatch[1]))) as 1|2|3|4|5|6 : 1;

      return {
        id: blockId,
        type: 'heading',
        level,
        text,
        runs,
      };
    }

    return {
      id: blockId,
      type: 'paragraph',
      text,
      runs,
    };
  }

  private parseRuns(xml: string, baseOffset: number): TextRun[] {
    const runs: TextRun[] = [];
    const runRegex = /<w:r[^>]*>([\s\S]*?)<\/w:r>/g;
    let match;

    while ((match = runRegex.exec(xml)) !== null) {
      const runContent = match[1];
      const textMatches = [...runContent.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)];

      for (const textMatch of textMatches) {
        const text = textMatch[1];
        if (text) {
          // 스타일 정보 추출
          const bold = /<w:b[^/]*\/?>/.test(runContent) || /<w:b /.test(runContent);
          const italic = /<w:i[^/]*\/?>/.test(runContent);
          const underline = /<w:u[^/]*\/?>/.test(runContent);

          runs.push({
            text,
            bold: bold || undefined,
            italic: italic || undefined,
            underline: underline || undefined,
            xmlStart: baseOffset + match.index!,
            xmlEnd: baseOffset + match.index! + match[0].length,
          });
        }
      }
    }

    return runs;
  }

  private parseTable(tableXml: string, xmlStart: number): TableBlock | null {
    const rows: TableRow[] = [];
    const rowRegex = /<w:tr[^>]*>([\s\S]*?)<\/w:tr>/g;
    let rowMatch;
    let rowIndex = 0;

    while ((rowMatch = rowRegex.exec(tableXml)) !== null) {
      const rowContent = rowMatch[0];
      const cells = this.parseTableRow(rowContent, rowIndex, xmlStart + rowMatch.index);
      rows.push({
        cells,
        isHeader: rowIndex === 0, // 첫 행을 헤더로 가정
      });
      rowIndex++;
    }

    if (rows.length === 0) return null;

    const maxCols = Math.max(...rows.map(r => r.cells.length));

    return {
      id: `b${++this.blockIndex}`,
      type: 'table',
      rows,
      columnCount: maxCols,
    };
  }

  private parseTableRow(rowXml: string, rowIndex: number, rowXmlStart: number): TableCell[] {
    const cells: TableCell[] = [];
    let colIndex = 0;
    let pos = 0;

    while (pos < rowXml.length) {
      const cellStart = rowXml.indexOf('<w:tc', pos);
      if (cellStart === -1) break;

      const cellEnd = this.findClosingTag(rowXml, cellStart, 'w:tc');
      if (cellEnd === -1) break;

      const cellXml = rowXml.substring(cellStart, cellEnd);
      const runs = this.parseRuns(cellXml, rowXmlStart + cellStart);
      const text = runs.map(r => r.text).join('');

      // 셀 병합 정보
      const gridSpanMatch = cellXml.match(/<w:gridSpan[^>]*w:val="(\d+)"/);
      const colSpan = gridSpanMatch ? parseInt(gridSpanMatch[1]) : 1;

      const vMergeMatch = cellXml.match(/<w:vMerge[^>]*w:val="(\w+)"/);
      const rowSpan = vMergeMatch?.includes('restart') ? undefined : (vMergeMatch ? 0 : 1);

      cells.push({
        text,
        runs,
        colSpan,
        rowSpan,
        rowIndex,
        colIndex,
        xmlStart: rowXmlStart + cellStart,
        xmlEnd: rowXmlStart + cellEnd,
      });

      colIndex += colSpan;
      pos = cellEnd;
    }

    return cells;
  }

  private extractAnchors(blocks: Block[]): Anchor[] {
    const anchors: Anchor[] = [];
    let anchorIndex = 0;

    for (const block of blocks) {
      if (block.type === 'heading') {
        anchors.push({
          anchor_id: `a${++anchorIndex}`,
          type: 'heading',
          text: block.text.substring(0, 50),
          block_id: block.id,
        });
      } else if (block.type === 'table') {
        // 테이블 시작 앵커
        anchors.push({
          anchor_id: `a${++anchorIndex}`,
          type: 'table_start',
          text: `Table with ${block.rows.length} rows`,
          block_id: block.id,
        });

        // 각 셀의 라벨 텍스트를 앵커로
        for (const row of block.rows) {
          for (const cell of row.cells) {
            const text = cell.text.trim();
            // 라벨처럼 보이는 셀 (짧고, 키워드 포함)
            if (text.length > 0 && text.length <= 30 && !text.includes('※')) {
              anchors.push({
                anchor_id: `a${++anchorIndex}`,
                type: 'cell',
                text: text,
                block_id: block.id,
                row: cell.rowIndex,
                col: cell.colIndex,
              });
            }
          }
        }
      }
    }

    return anchors;
  }
}

// 싱글톤 인스턴스
export const docxParser = new DocxParser();
