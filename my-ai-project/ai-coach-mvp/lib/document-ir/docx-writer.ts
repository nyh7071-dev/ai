// DOCX Patch Writer
// Fill 결과를 원본 DOCX에 서식 유지하면서 적용

import JSZip from 'jszip';
import {
  DocumentIR,
  SlotSchema,
  Slot,
  FillResult,
  SlotFill,
  DocumentPatch,
  PatchOp,
  TableBlock,
} from './types';

export class DocxWriter {
  private xml: string = '';

  async applyFills(
    originalBuffer: Buffer,
    ir: DocumentIR,
    schema: SlotSchema,
    fills: FillResult
  ): Promise<Buffer> {
    const zip = await JSZip.loadAsync(originalBuffer);
    const documentXml = await zip.file('word/document.xml')?.async('string');

    if (!documentXml) {
      throw new Error('document.xml을 찾을 수 없습니다');
    }

    this.xml = documentXml;

    // Fill을 Patch ops로 변환
    const patch = this.fillsToPatch(ir, schema, fills);

    // Patch 적용
    const modifiedXml = this.applyPatch(patch);

    // 결과 저장
    zip.file('word/document.xml', modifiedXml);
    return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>;
  }

  private fillsToPatch(ir: DocumentIR, schema: SlotSchema, fills: FillResult): DocumentPatch {
    const ops: PatchOp[] = [];

    for (const fill of fills.fills) {
      const slot = schema.slots.find(s => s.slot_id === fill.slot_id);
      if (!slot) continue;

      if (slot.selector.strategy === 'table_cell') {
        ops.push({
          op: 'set_cell_text',
          selector: {
            block_id: slot.selector.path.block_id,
            row: slot.selector.path.row!,
            cell: slot.selector.path.cell!,
          },
          text: fill.value,
        });
      } else if (slot.selector.strategy === 'paragraph' || slot.selector.strategy === 'heading_section') {
        ops.push({
          op: 'set_paragraph_text',
          selector: {
            block_id: slot.selector.path.block_id,
          },
          text: fill.value,
        });
      }
    }

    return {
      doc_id: ir.doc_id,
      ops,
    };
  }

  private applyPatch(patch: DocumentPatch): string {
    let xml = this.xml;

    // ops를 역순으로 정렬 (뒤에서부터 적용해야 위치가 안 꼬임)
    const sortedOps = [...patch.ops].sort((a, b) => {
      const posA = this.getOpPosition(a);
      const posB = this.getOpPosition(b);
      return posB - posA;
    });

    for (const op of sortedOps) {
      xml = this.applyOp(xml, op);
    }

    return xml;
  }

  private getOpPosition(op: PatchOp): number {
    // 대략적인 위치 추정 (실제로는 블록 ID로 찾아야 함)
    if (op.op === 'set_cell_text') {
      return parseInt(op.selector.block_id.replace('b', '')) * 10000 +
             op.selector.row * 100 +
             op.selector.cell;
    }
    return parseInt(op.selector.block_id.replace('b', '')) * 10000;
  }

  private applyOp(xml: string, op: PatchOp): string {
    switch (op.op) {
      case 'set_cell_text':
        return this.setCellText(xml, op.selector, op.text);
      case 'set_paragraph_text':
        return this.setParagraphText(xml, op.selector, op.text);
      default:
        return xml;
    }
  }

  private setCellText(
    xml: string,
    selector: { block_id: string; row: number; cell: number },
    text: string
  ): string {
    console.log(`[DocxWriter] setCellText: ${selector.block_id} row=${selector.row} cell=${selector.cell}`);
    console.log(`[DocxWriter] 값: "${text.substring(0, 50)}..."`);

    // block_id에서 블록 번호 추출 (예: "b5" → 5)
    const blockNum = parseInt(selector.block_id.replace('b', ''));

    // 해당 블록(테이블) 찾기
    const tableInfo = this.findTableByBlockNum(xml, blockNum);

    if (!tableInfo) {
      console.log(`[DocxWriter] 테이블을 찾지 못함: ${selector.block_id}`);
      return xml;
    }

    console.log(`[DocxWriter] 테이블 발견: ${tableInfo.start}-${tableInfo.end}`);

    // 테이블 내에서 셀 찾기
    const cell = this.findCellInTable(
      tableInfo.content,
      tableInfo.start,
      selector.row,
      selector.cell
    );

    if (!cell) {
      console.log(`[DocxWriter] 셀을 찾지 못함: row=${selector.row} cell=${selector.cell}`);
      return xml;
    }

    console.log(`[DocxWriter] 셀 발견: ${cell.start}-${cell.end}`);

    // 셀 내용 교체
    const newCellContent = this.replaceCellContent(cell.content, text);

    return xml.substring(0, cell.start) + newCellContent + xml.substring(cell.end);
  }

  // 블록 번호로 테이블 찾기
  private findTableByBlockNum(
    xml: string,
    blockNum: number
  ): { start: number; end: number; content: string } | null {
    let pos = 0;
    let blockCount = 0;

    // <w:body> 내용 추출
    const bodyMatch = xml.match(/<w:body[^>]*>([\s\S]*)<\/w:body>/);
    if (!bodyMatch) return null;

    const bodyContent = bodyMatch[1];
    const bodyOffset = bodyMatch.index! + bodyMatch[0].indexOf(bodyMatch[1]);

    while (pos < bodyContent.length) {
      // 테이블과 문단 중 먼저 나오는 것 찾기
      const tableStart = bodyContent.indexOf('<w:tbl', pos);
      const paraMatch = bodyContent.substring(pos).match(/<w:p(?:\s|>)/);
      const paraStart = paraMatch ? pos + paraMatch.index! : -1;

      let nextBlockStart = -1;
      let isTable = false;

      if (tableStart !== -1 && (paraStart === -1 || tableStart < paraStart)) {
        nextBlockStart = tableStart;
        isTable = true;
      } else if (paraStart !== -1) {
        nextBlockStart = paraStart;
        isTable = false;
      } else {
        break;
      }

      blockCount++;

      if (isTable) {
        const tableEnd = this.findClosingTag(bodyContent, tableStart, 'w:tbl');
        if (tableEnd === -1) {
          pos = tableStart + 6;
          continue;
        }

        if (blockCount === blockNum) {
          return {
            start: bodyOffset + tableStart,
            end: bodyOffset + tableEnd,
            content: bodyContent.substring(tableStart, tableEnd),
          };
        }

        pos = tableEnd;
      } else {
        const paraEnd = this.findClosingTag(bodyContent, paraStart, 'w:p');
        if (paraEnd === -1) {
          pos = paraStart + 4;
          continue;
        }
        pos = paraEnd;
      }
    }

    return null;
  }

  private setParagraphText(
    xml: string,
    selector: { block_id: string },
    text: string
  ): string {
    // 문단 찾기
    const paraIndex = parseInt(selector.block_id.replace('b', ''));
    const para = this.findParagraph(xml, paraIndex);

    if (!para) {
      console.log(`[DocxWriter] 문단을 찾지 못함: ${selector.block_id}`);
      return xml;
    }

    // 문단 내용 교체
    const newContent = this.replaceParagraphContent(para.content, text);

    return xml.substring(0, para.start) + newContent + xml.substring(para.end);
  }

  private findTableCell(
    xml: string,
    tableIndex: number,
    rowIndex: number,
    cellIndex: number
  ): { start: number; end: number; content: string } | null {
    // n번째 테이블 찾기
    let tableCount = 0;
    let pos = 0;

    while (pos < xml.length) {
      const tableStart = xml.indexOf('<w:tbl', pos);
      if (tableStart === -1) break;

      tableCount++;
      const tableEnd = this.findClosingTag(xml, tableStart, 'w:tbl');

      if (tableEnd === -1) {
        pos = tableStart + 6;
        continue;
      }

      if (tableCount === tableIndex) {
        // 이 테이블에서 셀 찾기
        const tableContent = xml.substring(tableStart, tableEnd);
        return this.findCellInTable(tableContent, tableStart, rowIndex, cellIndex);
      }

      pos = tableEnd;
    }

    return null;
  }

  private findCellInTable(
    tableXml: string,
    tableOffset: number,
    rowIndex: number,
    cellIndex: number
  ): { start: number; end: number; content: string } | null {
    let rowCount = 0;
    let pos = 0;

    while (pos < tableXml.length) {
      const rowStart = tableXml.indexOf('<w:tr', pos);
      if (rowStart === -1) break;

      const rowEnd = this.findClosingTag(tableXml, rowStart, 'w:tr');

      if (rowEnd === -1) {
        pos = rowStart + 5;
        continue;
      }

      if (rowCount === rowIndex) {
        // 이 행에서 셀 찾기
        const rowContent = tableXml.substring(rowStart, rowEnd);
        return this.findCellInRow(rowContent, tableOffset + rowStart, cellIndex);
      }

      rowCount++;
      pos = rowEnd;
    }

    return null;
  }

  private findCellInRow(
    rowXml: string,
    rowOffset: number,
    cellIndex: number
  ): { start: number; end: number; content: string } | null {
    let cellCount = 0;
    let pos = 0;

    while (pos < rowXml.length) {
      const cellStart = rowXml.indexOf('<w:tc', pos);
      if (cellStart === -1) break;

      const cellEnd = this.findClosingTag(rowXml, cellStart, 'w:tc');

      if (cellEnd === -1) {
        pos = cellStart + 5;
        continue;
      }

      if (cellCount === cellIndex) {
        return {
          start: rowOffset + cellStart,
          end: rowOffset + cellEnd,
          content: rowXml.substring(cellStart, cellEnd),
        };
      }

      cellCount++;
      pos = cellEnd;
    }

    return null;
  }

  private findParagraph(
    xml: string,
    paraIndex: number
  ): { start: number; end: number; content: string } | null {
    let paraCount = 0;
    let pos = 0;

    while (pos < xml.length) {
      // <w:p> 또는 <w:p ...> 찾기
      const paraMatch = xml.substring(pos).match(/<w:p(?:\s|>)/);
      if (!paraMatch) break;

      const paraStart = pos + paraMatch.index!;
      const paraEnd = this.findClosingTag(xml, paraStart, 'w:p');

      if (paraEnd === -1) {
        pos = paraStart + 4;
        continue;
      }

      paraCount++;

      if (paraCount === paraIndex) {
        return {
          start: paraStart,
          end: paraEnd,
          content: xml.substring(paraStart, paraEnd),
        };
      }

      pos = paraEnd;
    }

    return null;
  }

  private findClosingTag(xml: string, startPos: number, tagName: string): number {
    let depth = 0;
    let pos = startPos;

    while (pos < xml.length) {
      // 여는 태그 (<w:tc> 또는 <w:tc ...>)
      const openMatch = xml.substring(pos).match(new RegExp(`<${tagName}(?:\\s|>)`));
      const openPos = openMatch ? pos + openMatch.index! : -1;

      // 닫는 태그
      const closePos = xml.indexOf(`</${tagName}>`, pos);

      if (closePos === -1) return xml.length;

      if (openPos !== -1 && openPos < closePos) {
        depth++;
        pos = openPos + tagName.length + 1;
      } else {
        if (depth === 0) {
          return closePos + `</${tagName}>`.length;
        }
        depth--;
        pos = closePos + `</${tagName}>`.length;
      }
    }

    return xml.length;
  }

  private replaceCellContent(cellXml: string, newText: string): string {
    const escapedText = this.escapeXml(newText);

    // 모든 <w:t> 태그 찾기
    const textMatches = [...cellXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)];

    if (textMatches.length === 0) {
      // 텍스트 태그가 없으면 그대로 반환
      return cellXml;
    }

    // 첫 번째 <w:t>에 값 넣고 나머지는 비우기
    let result = cellXml;
    let offset = 0;

    for (let i = 0; i < textMatches.length; i++) {
      const match = textMatches[i];
      const matchStart = match.index! + offset;
      const matchEnd = matchStart + match[0].length;

      // 태그 구조 분석
      const tagMatch = match[0].match(/^(<w:t[^>]*>)[^<]*(<\/w:t>)$/);
      if (tagMatch) {
        let replacement: string;
        if (i === 0) {
          // 첫 번째 태그에 전체 값 넣기
          replacement = `${tagMatch[1]}${escapedText}${tagMatch[2]}`;
        } else {
          // 나머지는 빈 태그로
          replacement = `${tagMatch[1]}${tagMatch[2]}`;
        }

        result = result.substring(0, matchStart) + replacement + result.substring(matchEnd);
        offset += replacement.length - match[0].length;
      }
    }

    return result;
  }

  private replaceParagraphContent(paraXml: string, newText: string): string {
    // 문단 전체 텍스트 교체
    const escapedText = this.escapeXml(newText);

    // 첫 번째 <w:t> 찾기
    const firstTextMatch = paraXml.match(/(<w:t[^>]*>)[^<]*(<\/w:t>)/);
    if (!firstTextMatch) return paraXml;

    const firstTextIndex = paraXml.indexOf(firstTextMatch[0]);
    const before = paraXml.substring(0, firstTextIndex);
    const after = paraXml.substring(firstTextIndex + firstTextMatch[0].length);

    // 나머지 텍스트 태그 비우기
    const cleanedAfter = after.replace(/<w:t[^>]*>[^<]*<\/w:t>/g, '<w:t></w:t>');

    return before + `${firstTextMatch[1]}${escapedText}${firstTextMatch[2]}` + cleanedAfter;
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

export const docxWriter = new DocxWriter();
