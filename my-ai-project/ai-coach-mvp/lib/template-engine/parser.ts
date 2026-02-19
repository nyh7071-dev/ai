// DOCX Parser - Extract IR from DOCX buffer

import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import type { IR, IRNode } from "./types";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: true,
});

export async function parseDocxToIR(buffer: Buffer): Promise<IR> {
  const zip = await JSZip.loadAsync(buffer);
  const nodes: IRNode[] = [];
  const nodeCounter = { value: 0 };

  // Parse document.xml (main content)
  const documentXml = await zip.file("word/document.xml")?.async("text");
  if (documentXml) {
    const parsed = xmlParser.parse(documentXml);
    const body = parsed["w:document"]?.["w:body"];
    if (body) {
      extractNodesFromBody(body, nodes, "document", nodeCounter);
    }
  }

  // Parse headers
  const headerFiles = Object.keys(zip.files).filter((name) =>
    name.startsWith("word/header") && name.endsWith(".xml")
  );
  for (const headerFile of headerFiles) {
    const headerXml = await zip.file(headerFile)?.async("text");
    if (headerXml) {
      const parsed = xmlParser.parse(headerXml);
      const headerId = headerFile.match(/header(\d+)/)?.[1] || "0";
      extractNodesFromBody(
        parsed["w:hdr"],
        nodes,
        `header${headerId}`,
        nodeCounter
      );
    }
  }

  // Parse footers
  const footerFiles = Object.keys(zip.files).filter((name) =>
    name.startsWith("word/footer") && name.endsWith(".xml")
  );
  for (const footerFile of footerFiles) {
    const footerXml = await zip.file(footerFile)?.async("text");
    if (footerXml) {
      const parsed = xmlParser.parse(footerXml);
      const footerId = footerFile.match(/footer(\d+)/)?.[1] || "0";
      extractNodesFromBody(
        parsed["w:ftr"],
        nodes,
        `footer${footerId}`,
        nodeCounter
      );
    }
  }

  // Set neighbors
  for (let i = 0; i < nodes.length; i++) {
    if (i > 0) nodes[i].neighbors.prev = nodes[i - 1].nodeId;
    if (i < nodes.length - 1) nodes[i].neighbors.next = nodes[i + 1].nodeId;
  }

  return {
    nodes,
    metadata: {
      fileName: "document.docx",
    },
  };
}

function extractNodesFromBody(
  body: any,
  nodes: IRNode[],
  pathPrefix: string,
  nodeCounter: { value: number }
): void {
  if (!body) return;

  // Extract paragraphs
  const paragraphs = Array.isArray(body["w:p"]) ? body["w:p"] : body["w:p"] ? [body["w:p"]] : [];
  paragraphs.forEach((p: any, pIndex: number) => {
    const text = extractTextFromParagraph(p);
    if (text.trim()) {
      const styleHints = extractStyleHints(p);
      nodes.push({
        nodeId: `node_${nodeCounter.value++}`,
        text: text.trim(),
        path: `${pathPrefix}:p${pIndex}`,
        styleHints,
        neighbors: {},
        xmlPath: `${pathPrefix}:p${pIndex}`,
      });
    }
  });

  // Extract tables
  const tables = Array.isArray(body["w:tbl"]) ? body["w:tbl"] : body["w:tbl"] ? [body["w:tbl"]] : [];
  tables.forEach((tbl: any, tblIndex: number) => {
    const rows = Array.isArray(tbl["w:tr"]) ? tbl["w:tr"] : tbl["w:tr"] ? [tbl["w:tr"]] : [];

    rows.forEach((row: any, rowIndex: number) => {
      const cells = Array.isArray(row["w:tc"]) ? row["w:tc"] : row["w:tc"] ? [row["w:tc"]] : [];

      let labelLeft: string | undefined;
      cells.forEach((cell: any, colIndex: number) => {
        const cellText = extractTextFromCell(cell);
        if (cellText.trim()) {
          const styleHints = extractStyleHints(cell);

          // First column is often a label
          if (colIndex === 0) {
            labelLeft = cellText.trim();
          }

          nodes.push({
            nodeId: `node_${nodeCounter.value++}`,
            text: cellText.trim(),
            path: `${pathPrefix}:table${tblIndex}:r${rowIndex}:c${colIndex}`,
            styleHints,
            neighbors: {},
            tableContext: {
              rowIndex,
              colIndex,
              labelLeft: colIndex > 0 ? labelLeft : undefined,
            },
            xmlPath: `${pathPrefix}:table${tblIndex}:r${rowIndex}:c${colIndex}`,
          });
        }
      });
    });
  });
}

function extractTextFromParagraph(p: any): string {
  if (!p) return "";
  const runs = Array.isArray(p["w:r"]) ? p["w:r"] : p["w:r"] ? [p["w:r"]] : [];
  return runs.map((r: any) => {
    const t = r["w:t"];
    if (typeof t === "string") return t;
    if (t && typeof t === "object" && t["#text"]) return t["#text"];
    return "";
  }).join("");
}

function extractTextFromCell(cell: any): string {
  if (!cell) return "";
  const paragraphs = Array.isArray(cell["w:p"]) ? cell["w:p"] : cell["w:p"] ? [cell["w:p"]] : [];
  return paragraphs.map((p: any) => extractTextFromParagraph(p)).join("\n");
}

function extractStyleHints(element: any): IRNode["styleHints"] {
  const hints: IRNode["styleHints"] = {};

  // Try to extract from paragraph properties
  const pPr = element["w:pPr"];
  if (pPr) {
    const jc = pPr["w:jc"];
    if (jc && jc["@_w:val"]) {
      hints.alignment = jc["@_w:val"];
    }
  }

  // Try to extract from run properties
  const runs = Array.isArray(element["w:r"]) ? element["w:r"] : element["w:r"] ? [element["w:r"]] : [];
  if (runs.length > 0) {
    const rPr = runs[0]["w:rPr"];
    if (rPr) {
      if (rPr["w:b"]) hints.bold = true;
      if (rPr["w:i"]) hints.italic = true;
      if (rPr["w:sz"] && rPr["w:sz"]["@_w:val"]) {
        hints.fontSize = parseInt(rPr["w:sz"]["@_w:val"]) / 2; // Half-points to points
      }
      if (rPr["w:color"] && rPr["w:color"]["@_w:val"]) {
        hints.color = "#" + rPr["w:color"]["@_w:val"];
      }
    }
  }

  return hints;
}
