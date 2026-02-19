// DOCX Annotator - Mark slots in DOCX using SDT or bookmarks

import JSZip from "jszip";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import type { ClassifiedIR, TemplateEngineConfig } from "./types";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  preserveOrder: true,
  ignoreDeclaration: false,
  processEntities: false,
});

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  format: false,
  suppressEmptyNode: true,
  processEntities: false,
});

export async function annotateDocxWithSlots(
  buffer: Buffer,
  classifiedIR: ClassifiedIR,
  config: Partial<TemplateEngineConfig> = {}
): Promise<Buffer> {
  const annotationMethod = config.annotationMethod || "bookmark";

  const zip = await JSZip.loadAsync(buffer);

  // For now, use simple placeholder replacement method
  // This preserves maximum compatibility while still enabling slot filling
  const documentXml = await zip.file("word/document.xml")?.async("text");
  if (!documentXml) {
    throw new Error("document.xml not found");
  }

  let modifiedXml = documentXml;

  // Insert Content Controls for PLACEHOLDER nodes
  let sdtIdCounter = 1000;

  for (const classifiedNode of classifiedIR.nodes) {
    if (classifiedNode.action === "REPLACE" && classifiedNode.slot) {
      // Find text nodes that match common placeholder patterns
      const patterns = [
        "____",
        "________",
        "____________",
        "OOO",
        "000",
        "(          )",
        "[        ]",
        "홍길동"
      ];

      for (const pattern of patterns) {
        // Wrap text in Content Control with slot tag
        const textNodeRegex = new RegExp(
          `(<w:r[^>]*>(?:<w:rPr[^>]*>.*?<\\/w:rPr>)?<w:t[^>]*>)([^<]*${escapeRegex(pattern)}[^<]*)(<\\/w:t><\\/w:r>)`,
          "gi"
        );

        modifiedXml = modifiedXml.replace(
          textNodeRegex,
          (match, opening, text, closing) => {
            const sdtId = sdtIdCounter++;
            const slotName = classifiedNode.slot;

            return `<w:sdt><w:sdtPr><w:id w:val="${sdtId}"/><w:tag w:val="${slotName}"/><w:alias w:val="${slotName}"/></w:sdtPr><w:sdtContent>${opening}${text}${closing}</w:sdtContent></w:sdt>`;
          }
        );
      }
    }
  }

  // Update the zip with modified XML
  zip.file("word/document.xml", modifiedXml);

  // Generate the new buffer
  const newBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });

  return newBuffer;
}

// Helper function to escape regex special characters
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Helper function to wrap text in SDT (Content Control)
function wrapInSDT(textElement: any, slotName: string, id: number): any {
  return {
    "w:sdt": [
      {
        "w:sdtPr": [
          {
            "w:id": [{ "@_w:val": id.toString() }],
          },
          {
            "w:tag": [{ "@_w:val": slotName }],
          },
          {
            "w:alias": [{ "@_w:val": slotName }],
          },
        ],
      },
      {
        "w:sdtContent": [textElement],
      },
    ],
  };
}
