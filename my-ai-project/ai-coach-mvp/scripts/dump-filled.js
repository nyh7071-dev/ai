/**
 * dump-filled.js
 *
 * Parses a .docx file and dumps ALL content in order:
 *  - Top-level element types in w:body
 *  - Table cells (table index, row, col, text truncated to 60 chars)
 *  - Textbox content (w:txbxContent) with index
 *  - Paragraphs outside tables
 */

const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const { DOMParser } = require("@xmldom/xmldom");

const DOCX_PATH = String.raw`c:\Users\nyh7071\Downloads\filled_[별첨 1] 2025년도 예비창업패키지 사업계획서 양식 (34).docx`;

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

// helpers

function truncate(str, len) {
  if (len === undefined) len = 60;
  var s = str.replace(/[\r\n]+/g, " ").trim();
  return s.length > len ? s.slice(0, len) + "..." : s;
}

/** Recursively collect all text from w:t elements under a node */
function collectText(node) {
  if (!node) return "";
  var text = "";
  if (node.nodeType === 3 /* TEXT_NODE */) {
    return node.nodeValue || "";
  }
  if (node.localName === "t" && node.namespaceURI === W_NS) {
    for (var i = 0; i < node.childNodes.length; i++) {
      text += node.childNodes[i].nodeValue || "";
    }
    return text;
  }
  for (var i = 0; i < node.childNodes.length; i++) {
    text += collectText(node.childNodes[i]);
  }
  return text;
}

/** Collect all w:txbxContent elements anywhere inside a node */
function collectTextboxes(node, results) {
  if (!node || node.nodeType !== 1) return;
  if (node.localName === "txbxContent" && node.namespaceURI === W_NS) {
    results.push(node);
    return;
  }
  for (var i = 0; i < node.childNodes.length; i++) {
    collectTextboxes(node.childNodes[i], results);
  }
}

/** Get paragraphs inside a txbxContent */
function getTextboxParagraphs(txbxContent) {
  var paras = [];
  for (var i = 0; i < txbxContent.childNodes.length; i++) {
    var child = txbxContent.childNodes[i];
    if (child.nodeType === 1 && child.localName === "p" && child.namespaceURI === W_NS) {
      paras.push(collectText(child));
    }
  }
  return paras;
}

// main

async function main() {
  console.log("=== dump-filled.js ===");
  console.log("File: " + DOCX_PATH + "\n");

  var buf = fs.readFileSync(DOCX_PATH);
  var zip = await JSZip.loadAsync(buf);

  var xmlStr = await zip.file("word/document.xml").async("string");
  var doc = new DOMParser().parseFromString(xmlStr, "application/xml");

  var bodies = doc.getElementsByTagNameNS(W_NS, "body");
  if (bodies.length === 0) {
    console.error("ERROR: No w:body found!");
    return;
  }
  var body = bodies[0];

  var tableIdx = 0;
  var paraIdx = 0;
  var textboxGlobalIdx = 0;
  var elementIdx = 0;

  for (var i = 0; i < body.childNodes.length; i++) {
    var el = body.childNodes[i];
    if (el.nodeType !== 1) continue;

    var tag = el.localName;
    elementIdx++;

    // TABLE
    if (tag === "tbl") {
      tableIdx++;
      console.log("\n[" + elementIdx + "] TABLE #" + tableIdx);
      console.log("-".repeat(80));

      var tbTextboxes = [];
      collectTextboxes(el, tbTextboxes);

      var rows = el.getElementsByTagNameNS(W_NS, "tr");
      for (var r = 0; r < rows.length; r++) {
        var cells = rows[r].getElementsByTagNameNS(W_NS, "tc");
        for (var c = 0; c < cells.length; c++) {
          var cellText = collectText(cells[c]);
          var display = truncate(cellText);
          var marker = cellText.trim() === "" ? " [EMPTY]" : "";
          console.log("  T" + tableIdx + " R" + r + " C" + c + ": " + display + marker);
        }
      }

      if (tbTextboxes.length > 0) {
        console.log("  --- Textboxes inside Table #" + tableIdx + " ---");
        for (var t = 0; t < tbTextboxes.length; t++) {
          textboxGlobalIdx++;
          var paras = getTextboxParagraphs(tbTextboxes[t]);
          var joined = paras.join(" | ");
          var display2 = truncate(joined, 100);
          var marker2 = joined.trim() === "" ? " [EMPTY]" : "";
          console.log("  TEXTBOX #" + textboxGlobalIdx + ": " + display2 + marker2);
        }
      }
    }
    // PARAGRAPH
    else if (tag === "p") {
      paraIdx++;
      var text = collectText(el);

      var pTextboxes = [];
      collectTextboxes(el, pTextboxes);

      if (pTextboxes.length > 0) {
        var pmarker = text.trim() === "" ? "" : ' (para text: "' + truncate(text, 40) + '")';
        console.log("\n[" + elementIdx + "] PARA #" + paraIdx + " [contains " + pTextboxes.length + " textbox(es)]" + pmarker);
        for (var t2 = 0; t2 < pTextboxes.length; t2++) {
          textboxGlobalIdx++;
          var paras2 = getTextboxParagraphs(pTextboxes[t2]);
          var joined2 = paras2.join(" | ");
          var display3 = truncate(joined2, 100);
          var emptyMarker = joined2.trim() === "" ? " [EMPTY]" : "";
          console.log("  TEXTBOX #" + textboxGlobalIdx + ": " + display3 + emptyMarker);
        }
      } else {
        var display4 = truncate(text);
        var marker3 = text.trim() === "" ? " [EMPTY]" : "";
        console.log("[" + elementIdx + "] PARA #" + paraIdx + ": " + display4 + marker3);
      }
    }
    // SDT
    else if (tag === "sdt") {
      console.log("\n[" + elementIdx + "] SDT (Structured Document Tag)");
      var sdtText = collectText(el);
      console.log("  Text: " + truncate(sdtText, 100));

      var sdtTextboxes = [];
      collectTextboxes(el, sdtTextboxes);
      if (sdtTextboxes.length > 0) {
        for (var t3 = 0; t3 < sdtTextboxes.length; t3++) {
          textboxGlobalIdx++;
          var paras3 = getTextboxParagraphs(sdtTextboxes[t3]);
          var joined3 = paras3.join(" | ");
          var display5 = truncate(joined3, 100);
          var emptyMarker2 = joined3.trim() === "" ? " [EMPTY]" : "";
          console.log("  TEXTBOX #" + textboxGlobalIdx + ": " + display5 + emptyMarker2);
        }
      }
    }
    // ANYTHING ELSE
    else {
      var otherText = collectText(el);
      var extra = otherText.trim() ? ' text="' + truncate(otherText, 40) + '"' : "";
      console.log("[" + elementIdx + "] <w:" + tag + ">" + extra);
    }
  }

  // Summary
  console.log("\n" + "=".repeat(80));
  console.log("SUMMARY");
  console.log("  Top-level elements: " + elementIdx);
  console.log("  Tables:             " + tableIdx);
  console.log("  Paragraphs:         " + paraIdx);
  console.log("  Textboxes found:    " + textboxGlobalIdx);
  console.log("=".repeat(80));
}

main().catch(function(err) {
  console.error("FATAL:", err);
  process.exit(1);
});
