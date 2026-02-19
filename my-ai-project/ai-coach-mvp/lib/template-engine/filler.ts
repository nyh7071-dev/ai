// DOCX Filler - Fill slots while preserving formatting

import JSZip from "jszip";
import type { ClassifiedIR, SlotValue } from "./types";

export async function fillSlots(
  buffer: Buffer,
  slotValues: SlotValue[],
  classifiedIR: ClassifiedIR
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);

  // Process document.xml (main content)
  await processXmlFile(zip, "word/document.xml", slotValues);

  // Process headers
  const headerFiles = Object.keys(zip.files).filter((name) =>
    name.startsWith("word/header") && name.endsWith(".xml")
  );
  for (const headerFile of headerFiles) {
    await processXmlFile(zip, headerFile, slotValues);
  }

  // Process footers
  const footerFiles = Object.keys(zip.files).filter((name) =>
    name.startsWith("word/footer") && name.endsWith(".xml")
  );
  for (const footerFile of footerFiles) {
    await processXmlFile(zip, footerFile, slotValues);
  }

  // Generate filled buffer
  const filledBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });

  return filledBuffer;
}

async function processXmlFile(
  zip: JSZip,
  filePath: string,
  slotValues: SlotValue[]
): Promise<void> {
  const xmlContent = await zip.file(filePath)?.async("text");
  if (!xmlContent) return;

  try {
    let modifiedXml = xmlContent;

    // Simple text replacement strategy
    // Replace common placeholder patterns with actual values
    for (const { slot, value } of slotValues) {
      if (!value) continue;

      // Patterns to replace
      const patterns = [
        // Explicit slot markers
        `{{${slot}}}`,
        `{${slot}}`,

        // Common Korean placeholders based on slot name
        ...(slot.includes("name") || slot.includes("이름") || slot.includes("성명")
          ? ["홍길동", "OOO", "성명", "이름"]
          : []),

        ...(slot.includes("company") || slot.includes("기업") || slot.includes("회사")
          ? ["주식회사 OOO", "기업명", "회사명", "OOO 주식회사"]
          : []),

        ...(slot.includes("date") || slot.includes("날짜")
          ? ["YYYY-MM-DD", "년  월  일", "____년 __월 __일"]
          : []),

        ...(slot.includes("address") || slot.includes("주소")
          ? ["주소", "소재지"]
          : []),

        // Generic placeholders
        "____________",
        "________",
        "____",
        "(          )",
        "[        ]",
        "OOO",
        "000",
      ];

      // Replace each pattern
      for (const pattern of patterns) {
        // Use regex to find text nodes containing the pattern
        const textNodeRegex = new RegExp(
          `(<w:t[^>]*>)([^<]*${escapeRegex(pattern)}[^<]*)(<\\/w:t>)`,
          "gi"
        );

        modifiedXml = modifiedXml.replace(
          textNodeRegex,
          (match, opening, text, closing) => {
            const replacedText = text.replace(
              new RegExp(escapeRegex(pattern), "gi"),
              value
            );
            return `${opening}${replacedText}${closing}`;
          }
        );
      }

      // Also try to find and replace based on Korean label matching
      // Look for patterns like "이름:" followed by placeholder
      const labelPatterns = [
        slot,
        slot.replace(/_/g, " "),
        ...getKoreanLabelsForSlot(slot),
      ];

      for (const label of labelPatterns) {
        // Pattern: <w:t>label:</w:t>...potentially other elements...<w:t>placeholder</w:t>
        const labelPlaceholderRegex = new RegExp(
          `(<w:t[^>]*>${escapeRegex(label)}[:\uff1a]?<\\/w:t>[^]*?)(<w:t[^>]*>)([^<]{0,30}?(?:_+|\\[\\s*\\]|\\(\\s*\\)|OOO|000))(<\\/w:t>)`,
          "gi"
        );

        modifiedXml = modifiedXml.replace(
          labelPlaceholderRegex,
          (match, before, opening, placeholder, closing) => {
            return `${before}${opening}${value}${closing}`;
          }
        );
      }
    }

    zip.file(filePath, modifiedXml);
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error);
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getKoreanLabelsForSlot(slot: string): string[] {
  const mapping: Record<string, string[]> = {
    name: ["이름", "성명"],
    company_name: ["회사명", "기업명", "업체명"],
    date: ["날짜", "작성일", "일자"],
    address: ["주소", "소재지"],
    phone: ["전화번호", "연락처"],
    email: ["이메일", "전자우편"],
    amount: ["금액", "가격"],
    content: ["내용"],
    description: ["설명", "상세"],
    problem: ["문제", "이슈"],
    goal: ["목표", "목적"],
    market: ["시장"],
  };

  const labels: string[] = [];
  for (const [key, koreanLabels] of Object.entries(mapping)) {
    if (slot.toLowerCase().includes(key)) {
      labels.push(...koreanLabels);
    }
  }

  return labels;
}
