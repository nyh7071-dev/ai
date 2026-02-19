// Slot Schema 추출기
// Document IR에서 채워야 할 Slot들을 추출

import { createHash } from 'crypto';
import {
  DocumentIR,
  Block,
  TableBlock,
  HeadingBlock,
  ParagraphBlock,
  TableCell,
  SlotSchema,
  Slot,
  SlotType,
  SlotSelector,
  SlotConstraints,
  SlotContext,
} from './types';

// 라벨 키워드 (점수 부여용)
const LABEL_KEYWORDS = [
  // 기본 정보
  '성명', '이름', '대표자', '담당자', '연락처', '전화', '이메일', '주소', '소재지',
  '사업자', '등록번호', '설립일', '창업일', '업종', '업태',
  // 사업계획서 관련
  '사업명', '아이템', '명칭', '제목', '개요', '요약', '목적', '배경', '필요성',
  '문제', '해결', '솔루션', '기술', '제품', '서비스', '시장', '고객', '타겟',
  '경쟁', '차별', '강점', '약점', '전략', '계획', '일정', '로드맵', '마일스톤',
  '예산', '비용', '금액', '매출', '수익', '투자', '자금',
  '팀', '인력', '조직', '역할', '담당', '경력', '학력', '역량',
  '범주', '분류', '카테고리',
  // 영문
  'Problem', 'Solution', 'Team', 'Market', 'Revenue', 'Name', 'Title',
];

// 플레이스홀더 패턴
const PLACEHOLDER_PATTERNS = [
  /^※/,                    // ※로 시작
  /^ㅇ\s*$/,               // ㅇ만 있는 경우
  /^O{3,}/,                // OOOOO
  /^-\s*$/,                // -만 있는 경우
  /작성|기재|입력/,         // 작성요령
  /예시|예\s*:/,           // 예시
  /\(\s*\)/,               // 빈 괄호
  /_{3,}/,                 // 밑줄
];

// 숫자/금액 패턴
const NUMBER_PATTERNS = [
  /\d+원/,
  /\d+만원/,
  /\d+억/,
  /\d{1,3}(,\d{3})+/,
];

export class SlotExtractor {
  private slotIndex: number = 0;

  extract(ir: DocumentIR): SlotSchema {
    this.slotIndex = 0;
    const slots: Slot[] = [];

    for (const block of ir.blocks) {
      if (block.type === 'table') {
        const tableSlots = this.extractTableSlots(block, ir);
        slots.push(...tableSlots);
      } else if (block.type === 'heading') {
        // 섹션 기반 슬롯 (헤딩 다음 내용)
        const sectionSlots = this.extractSectionSlots(block, ir);
        slots.push(...sectionSlots);
      }
    }

    // 중복 제거 및 정리
    const uniqueSlots = this.deduplicateSlots(slots);

    // 템플릿 ID 생성 (내용 해시)
    const templateId = this.generateTemplateId(ir);

    return {
      template_id: templateId,
      created_at: new Date().toISOString(),
      slots: uniqueSlots,
    };
  }

  private extractTableSlots(table: TableBlock, ir: DocumentIR): Slot[] {
    const slots: Slot[] = [];

    console.log(`[SlotExtractor] 테이블 분석: ${table.rows.length}행`);

    for (let rowIdx = 0; rowIdx < table.rows.length; rowIdx++) {
      const row = table.rows[rowIdx];

      for (let cellIdx = 0; cellIdx < row.cells.length; cellIdx++) {
        const cell = row.cells[cellIdx];
        const cellText = cell.text.trim();

        if (!cellText) continue;

        // 1. 플레이스홀더가 있는 셀 찾기 (※로 시작)
        if (this.hasPlaceholder(cellText)) {
          // 이전 셀이나 같은 행의 첫 셀이 라벨일 수 있음
          let labelCell = cellIdx > 0 ? row.cells[cellIdx - 1] : null;
          let labelText = labelCell?.text.trim() || '';

          // 같은 셀에 라벨이 있는 경우 (예: "명칭\n※ 예시...")
          if (!labelText || this.hasPlaceholder(labelText)) {
            const lines = cellText.split('\n');
            if (lines.length > 1 && !lines[0].startsWith('※')) {
              labelText = lines[0].trim();
            }
          }

          if (labelText && labelText.length >= 2 && labelText.length <= 50) {
            const slot = this.createTableCellSlot(
              table,
              { ...cell, text: labelText } as any,
              cell,
              this.inferSlotType(labelText, cellText)
            );
            if (slot) {
              console.log(`[SlotExtractor] 슬롯 발견: "${labelText}" → row=${rowIdx}, cell=${cellIdx}`);
              slots.push(slot);
            }
          }
          continue;
        }

        // 2. 라벨 점수 계산
        const labelScore = this.calculateLabelScore(cellText);

        if (labelScore >= 2) {
          // 라벨 셀로 판단 → 다음 셀이 값 셀
          const valueCell = row.cells[cellIdx + 1];

          if (valueCell && valueCell.text.trim()) {
            const slot = this.createTableCellSlot(
              table,
              cell,
              valueCell,
              this.inferSlotType(cellText, valueCell.text)
            );
            if (slot) {
              console.log(`[SlotExtractor] 슬롯 발견: "${cellText}" → row=${rowIdx}, cell=${cellIdx + 1}`);
              slots.push(slot);
            }
          }
        }
      }

      // 반복 테이블 감지 (헤더 + 빈 행들)
      if (rowIdx === 0 && this.isRepeatTableHeader(row)) {
        const repeatSlot = this.createRepeatTableSlot(table, row);
        if (repeatSlot) slots.push(repeatSlot);
      }
    }

    return slots;
  }

  private extractSectionSlots(heading: HeadingBlock, ir: DocumentIR): Slot[] {
    const slots: Slot[] = [];

    // 해당 헤딩 다음 블록 찾기
    const headingIndex = ir.blocks.findIndex(b => b.id === heading.id);
    if (headingIndex === -1) return slots;

    // 다음 헤딩 전까지의 블록들 수집
    const sectionBlocks: Block[] = [];
    for (let i = headingIndex + 1; i < ir.blocks.length; i++) {
      const block = ir.blocks[i];
      if (block.type === 'heading' && (block as HeadingBlock).level <= heading.level) {
        break;
      }
      sectionBlocks.push(block);
    }

    // 섹션 내 서술형 슬롯 찾기
    for (const block of sectionBlocks) {
      if (block.type === 'paragraph') {
        const para = block as ParagraphBlock;
        if (this.hasPlaceholder(para.text) || para.text.length < 10) {
          // 플레이스홀더가 있거나 매우 짧은 문단 → 슬롯
          const slot = this.createSectionSlot(heading, para);
          if (slot) slots.push(slot);
        }
      }
    }

    return slots;
  }

  private calculateLabelScore(text: string): number {
    let score = 0;

    // 플레이스홀더가 있으면 라벨 아님
    if (this.hasPlaceholder(text)) return 0;

    // 길이 체크 (2~50자가 라벨로 적합)
    if (text.length >= 2 && text.length <= 50) score += 1;

    // 키워드 포함 (가장 중요)
    for (const keyword of LABEL_KEYWORDS) {
      if (text.includes(keyword)) {
        score += 3;
        break;
      }
    }

    // 영문 키워드 (Problem, Solution 등)
    if (/Problem|Solution|Team|Scale|Market/i.test(text)) {
      score += 3;
    }

    // : ) ] 등으로 끝남
    if (/[:)】\]]\s*$/.test(text)) score += 1;

    // 괄호 안에 영문이 있음 (예: "문제 인식(Problem)")
    if (/\([A-Za-z]+\)/.test(text)) score += 2;

    // 숫자로만 이루어지지 않음
    if (!/^\d+$/.test(text)) score += 1;

    // □ 체크박스 마크가 있으면 라벨
    if (/^□/.test(text)) score += 2;

    return score;
  }

  private hasPlaceholder(text: string): boolean {
    return PLACEHOLDER_PATTERNS.some(pattern => pattern.test(text));
  }

  private isRepeatTableHeader(row: { cells: TableCell[] }): boolean {
    // 컬럼 헤더처럼 보이는지 (구분, 내용, 기간, 비고 등)
    const headerKeywords = ['구분', '항목', '내용', '기간', '일정', '금액', '비고', '담당', 'No', '번호'];
    let matchCount = 0;

    for (const cell of row.cells) {
      const text = cell.text.trim();
      if (headerKeywords.some(kw => text.includes(kw))) {
        matchCount++;
      }
    }

    return matchCount >= 2;
  }

  private inferSlotType(labelText: string, valueText: string): SlotType {
    // 금액
    if (/금액|비용|예산|매출|투자/.test(labelText)) return 'money';
    if (NUMBER_PATTERNS.some(p => p.test(valueText))) return 'money';

    // 날짜
    if (/일자|날짜|기간|년도|월/.test(labelText)) return 'date';

    // 숫자
    if (/수량|개수|인원/.test(labelText)) return 'number';

    // 체크박스
    if (/□|☐|해당|체크/.test(valueText)) return 'checkbox';

    // 선택형
    if (/예\s*\/\s*아니오|해당\s*\/\s*비해당/.test(valueText)) return 'enum';

    // 긴 서술
    if (valueText.length > 100 || /개요|요약|설명|내용|계획|전략/.test(labelText)) {
      return 'long_text';
    }

    return 'short_text';
  }

  private createTableCellSlot(
    table: TableBlock,
    labelCell: TableCell,
    valueCell: TableCell,
    slotType: SlotType
  ): Slot | null {
    const label = labelCell.text.trim();
    if (!label) return null;

    return {
      slot_id: `s_${++this.slotIndex}`.padStart(6, '0'),
      label,
      slot_type: slotType,
      selector: {
        strategy: 'table_cell',
        path: {
          block_id: table.id,
          row: valueCell.rowIndex,
          cell: valueCell.colIndex,
          xmlStart: valueCell.xmlStart,
          xmlEnd: valueCell.xmlEnd,
        },
        fallback_anchors: [
          {
            label_text: label,
            before: labelCell.text,
          },
        ],
      },
      constraints: this.inferConstraints(slotType, valueCell.text),
      context: {
        nearby_text: [labelCell.text, valueCell.text.substring(0, 50)],
      },
    };
  }

  private createSameCellSlot(table: TableBlock, cell: TableCell): Slot | null {
    // 라벨과 플레이스홀더가 같은 셀에 있는 경우
    const text = cell.text.trim();

    // 라벨 부분 추출 (플레이스홀더 전까지)
    const labelMatch = text.match(/^([^※ㅇ\n]+)/);
    const label = labelMatch ? labelMatch[1].trim() : text.substring(0, 20);

    return {
      slot_id: `s_${++this.slotIndex}`.padStart(6, '0'),
      label,
      slot_type: this.hasPlaceholder(text) ? 'long_text' : 'short_text',
      selector: {
        strategy: 'table_cell',
        path: {
          block_id: table.id,
          row: cell.rowIndex,
          cell: cell.colIndex,
          xmlStart: cell.xmlStart,
          xmlEnd: cell.xmlEnd,
        },
        fallback_anchors: [
          { label_text: label },
        ],
      },
      context: {
        nearby_text: [text.substring(0, 50)],
      },
    };
  }

  private createRepeatTableSlot(table: TableBlock, headerRow: { cells: TableCell[] }): Slot | null {
    const headers = headerRow.cells.map(c => c.text.trim()).filter(t => t);

    return {
      slot_id: `s_${++this.slotIndex}`.padStart(6, '0'),
      label: '반복 테이블',
      slot_type: 'table_repeat',
      selector: {
        strategy: 'table_repeat',
        path: {
          block_id: table.id,
        },
      },
      context: {
        table_headers: headers,
      },
    };
  }

  private createSectionSlot(heading: HeadingBlock, para: ParagraphBlock): Slot | null {
    return {
      slot_id: `s_${++this.slotIndex}`.padStart(6, '0'),
      label: heading.text.trim(),
      slot_type: 'long_text',
      selector: {
        strategy: 'heading_section',
        path: {
          block_id: para.id,
        },
        fallback_anchors: [
          { before: heading.text },
        ],
      },
      constraints: this.inferSectionConstraints(para.text),
      context: {
        section: heading.text,
      },
    };
  }

  private inferConstraints(slotType: SlotType, valueText: string): SlotConstraints {
    const constraints: SlotConstraints = {};

    // 글자수 힌트 추출
    const charMatch = valueText.match(/(\d+)자\s*(이내|이상|내외)/);
    if (charMatch) {
      const num = parseInt(charMatch[1]);
      if (charMatch[2] === '이내') constraints.max_chars = num;
      else if (charMatch[2] === '이상') constraints.min_chars = num;
    }

    // 플레이스홀더에서 힌트 추출
    if (valueText.includes('예시')) {
      const hintMatch = valueText.match(/예시[:\s]*([^※\n]+)/);
      if (hintMatch) constraints.hint = hintMatch[1].trim();
    }

    return constraints;
  }

  private inferSectionConstraints(paraText: string): SlotConstraints {
    const constraints: SlotConstraints = {};

    // 작성요령에서 힌트 추출
    if (paraText.includes('※')) {
      constraints.hint = paraText.match(/※([^※\n]+)/)?.[1]?.trim();
    }

    return constraints;
  }

  private deduplicateSlots(slots: Slot[]): Slot[] {
    const seen = new Map<string, Slot>();

    for (const slot of slots) {
      const key = `${slot.selector.path.block_id}-${slot.selector.path.row}-${slot.selector.path.cell}`;

      if (!seen.has(key)) {
        seen.set(key, slot);
      }
    }

    return Array.from(seen.values());
  }

  private generateTemplateId(ir: DocumentIR): string {
    // 문서 구조의 해시 생성
    const structureString = ir.blocks.map(b => {
      if (b.type === 'table') return `table:${(b as TableBlock).rows.length}x${(b as TableBlock).columnCount}`;
      if (b.type === 'heading') return `h${(b as HeadingBlock).level}:${(b as HeadingBlock).text.substring(0, 20)}`;
      return b.type;
    }).join('|');

    return createHash('md5').update(structureString).digest('hex').substring(0, 16);
  }
}

export const slotExtractor = new SlotExtractor();
