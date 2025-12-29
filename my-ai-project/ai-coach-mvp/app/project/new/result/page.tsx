"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { useSearchParams } from "next/navigation";
import * as mammoth from "mammoth/mammoth.browser";

/** ---------------------------
 *  Utils (컴포넌트 밖: 의존성 안정화)
 * --------------------------- */
function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function uniqUpper(arr: string[]) {
  const set = new Set<string>();
  for (const x of arr) {
    const k = String(x || "").toUpperCase().trim();
    if (k) set.add(k);
  }
  return Array.from(set);
}

function buildPaperMatrixKeys(maxRow = 12, maxCol = 8) {
  const out: string[] = [];
  for (let r = 1; r <= maxRow; r++) {
    for (let c = 1; c <= maxCol; c++) {
      out.push(`PAPER_${r}_${c}`);
    }
  }
  return out;
}

/** URL type(한글) -> 템플릿 파일명(영문) */
const TYPE_MAP: Record<string, string> = {
  레포트: "report",
  실험보고서: "lab_report",
  논문: "thesis",
  강의노트: "lecture_note",
  문헌고찰: "review",
};

type ChatMsg = { role: "ai" | "user"; text: string };

type TableShape = {
  title?: string;
  columns: string[];
  rows: Array<Array<string | number | null>>;
};

type PatchJson = Record<string, any> & { DELETE?: string[] };

export default function ResultPage() {
  return (
    <Suspense fallback={<div style={{ padding: 20, color: "#666" }}>워드 엔진 가동 중...</div>}>
      <Workspace />
    </Suspense>
  );
}

function Workspace() {
  const searchParams = useSearchParams();

  /** ---------------------------
   *  1) type / template 경로
   * --------------------------- */
  const rawType = searchParams.get("type") || "레포트";
  const templateFileName = useMemo(() => TYPE_MAP[rawType] || "report", [rawType]);
  const templateUrl = useMemo(() => `/templates/${templateFileName}.docx`, [templateFileName]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [frameReady, setFrameReady] = useState(false);
  const [docHTML, setDocHTML] = useState<string>("");
  const [sourceText, setSourceText] = useState<string>("");
  const [fieldData, setFieldData] = useState<Record<string, any>>({});

  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      role: "ai",
      text: `[${rawType}] 양식으로 시작합니다. PDF 업로드 → 자동 채움 → 피드백 반영까지 지원합니다.`,
    },
  ]);

  const [userInput, setUserInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState("");

  /** ---------------------------
   *  2) 템플릿별 토큰(허용 키) 세팅
   *     - 레포트만 고정키였던 문제 해결
   * --------------------------- */
  const TABLE_KEYS = useMemo(() => Array.from({ length: 10 }, (_, i) => `TABLE_${i + 1}`), []);

  const defaultTokensByTemplate = useMemo(() => {
    // 템플릿 토큰(플레이스홀더) 기반으로 허용 키를 잡는다.
    if (templateFileName === "lecture_note") {
      return [
        "COURSE",
        "DATE",
        "TOPIC",
        "LECTURER",
        "CUES",
        "NOTES",
        "SUMMARY",
        "LEARNING_OBJECTIVES",
        "KEY_POINTS",
        "TERMS",
        "EXAMPLES",
        "QUESTIONS",
        "NEXT_ACTIONS",
      ];
    }

    if (templateFileName === "lab_report") {
      return [
        "TITLE",
        "COURSE",
        "INSTRUCTOR",
        "EXPERIMENT_NAME",
        "EXPERIMENT_DATE",
        "SUBMIT_DATE",
        "DEPARTMENT",
        "STUDENT_ID",
        "STUDENT_NAME",
        "OBJECTIVE",
        "BACKGROUND",
        "MATERIALS_EQUIPMENT",
        "METHODS",
        "RAW_DATA",
        "PROCESSED_RESULTS",
        "DISCUSSION",
        "CONCLUSION",
        "REFERENCES",
        "APPENDIX",
      ];
    }

    if (templateFileName === "thesis") {
      return [
        "PAPER_TITLE_KO",
        "PAPER_TITLE_EN",
        "AUTHORS",
        "AFFILIATIONS",
        "ABSTRACT",
        "KEYWORDS",
        "INTRODUCTION",
        "METHODS",
        "RESULTS",
        "DISCUSSION",
        "CONCLUSION",
        "REFERENCES",
        "APPENDIX",
      ];
    }

    if (templateFileName === "review") {
      return [
        "TITLE",
        "COURSE",
        "INSTRUCTOR",
        "SUBMIT_DATE",
        "DEPARTMENT",
        "STUDENT_ID",
        "STUDENT_NAME",
        "RESEARCH_QUESTION",
        "SCOPE_DEFINITIONS",
        "DATABASES",
        "SEARCH_QUERY",
        "FILTERS",
        "INCLUSION_CRITERIA",
        "EXCLUSION_CRITERIA",
        "SCREENING_LOG",
        "THEMES_SUMMARY",
        "GAP_IMPLICATIONS",
        "REFERENCES",
        "APPENDIX",
        ...buildPaperMatrixKeys(12, 8), // 문헌요약표 셀(기본 12x8)
      ];
    }

    // report(기존 레포트)
    return [
      "TITLE",
      "ABSTRACT",
      "TOC",
      "INTRODUCTION",
      "BODY_1",
      "BODY_2",
      "BODY_3",
      "CONCLUSION",
      "REFERENCES",
      "APPENDIX",
      "INSTRUCTOR",
      "COURSE",
      "DEPARTMENT",
      "STUDENT_ID",
      "STUDENT_NAME",
    ];
  }, [templateFileName]);

  // 템플릿 실제 HTML에서 토큰을 추가로 추출해 허용키에 보강(유연성)
  const [templateExtractedTokens, setTemplateExtractedTokens] = useState<string[]>([]);
  useEffect(() => {
    setTemplateExtractedTokens([]); // 템플릿 타입 바뀌면 초기화
  }, [templateUrl]);

  const AVAILABLE_KEYS = useMemo(() => {
    const base = [...defaultTokensByTemplate, ...templateExtractedTokens];
    return uniqUpper(base);
  }, [defaultTokensByTemplate, templateExtractedTokens]);

  const allowedKeySet = useMemo(() => new Set(AVAILABLE_KEYS), [AVAILABLE_KEYS]);

  /** ---------------------------
   *  3) iframe로 HTML 주입
   * --------------------------- */
  const sendHtmlToIframe = useCallback(
    (html: string, source: "template" | "ai" | "user" = "ai", focusBlock?: string) => {
      const w = iframeRef.current?.contentWindow;
      if (!w) return;
      w.postMessage({ __editor: true, type: "SET_HTML", html, source, focusBlock }, "*");
    },
    []
  );

  /** ---------------------------
   *  4) 템플릿 HTML 정리
   * --------------------------- */
  const normalizeTemplateHTML = useCallback((html: string) => {
    let s = (html || "")
      .replace(/&lcub;/g, "{")
      .replace(/&rcub;/g, "}")
      .replace(/\u00a0/g, " ");
    s = s.replace(/\u0000/g, "");
    return s;
  }, []);

  /** ---------------------------
   *  5) 템플릿에서 토큰 추출(유연성 강화)
   *     - DOCX 내 토큰이 추가/변경되어도 자동으로 허용
   * --------------------------- */
  const extractTokensFromHtml = useCallback((html: string) => {
    try {
      const flat = String(html || "").replace(/<[^>]*>/g, " "); // 태그 제거
      const tokens: string[] = [];
      const re = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(flat)) !== null) {
        tokens.push(m[1].toUpperCase());
      }
      return uniqUpper(tokens);
    } catch {
      return [];
    }
  }, []);

  /** ---------------------------
   *  6) JSON parse & patch helpers
   * --------------------------- */
  const tryParseJsonLikeString = useCallback((value: any) => {
    if (typeof value !== "string") return value;

    const trimmed = value.trim();
    if (!trimmed) return value;

    const cleaned = trimmed.replace(/```json/gi, "").replace(/```/g, "").trim();

    const looksLikeObj = cleaned.startsWith("{") && cleaned.endsWith("}");
    const looksLikeArr = cleaned.startsWith("[") && cleaned.endsWith("]");

    if (!looksLikeObj && !looksLikeArr) return value;

    try {
      return JSON.parse(cleaned);
    } catch {
      return value;
    }
  }, []);

  const objectToDocHtml = useCallback((obj: any) => {
    if (!obj || typeof obj !== "object") return "";

    const title =
      typeof obj.title === "string" && obj.title.trim()
        ? `<div style="font-weight:800; font-size:18px; margin:10px 0 12px;">${escapeHtml(
            obj.title
          )}</div>`
        : "";

    if (Array.isArray(obj.content)) {
      const blocks = obj.content
        .map((it: any) => {
          if (!it) return "";

          const heading =
            typeof it.heading === "string" && it.heading.trim()
              ? `<div style="font-weight:700; margin:10px 0 6px;">${escapeHtml(
                  it.heading
                )}</div>`
              : "";

          const desc =
            typeof it.description === "string" && it.description.trim()
              ? `<div style="margin:0 0 10px; white-space:pre-wrap;">${escapeHtml(
                  it.description
                )}</div>`
              : "";

          if (!heading && !desc) {
            return `<div style="white-space:pre-wrap;">${escapeHtml(
              typeof it === "string" ? it : JSON.stringify(it, null, 2)
            )}</div>`;
          }

          return `<div>${heading}${desc}</div>`;
        })
        .join("");

      return `${title}${blocks}`;
    }

    if (typeof obj.heading === "string" || typeof obj.description === "string") {
      const h =
        typeof obj.heading === "string" && obj.heading.trim()
          ? `<div style="font-weight:700; margin:10px 0 6px;">${escapeHtml(obj.heading)}</div>`
          : "";
      const d =
        typeof obj.description === "string" && obj.description.trim()
          ? `<div style="white-space:pre-wrap;">${escapeHtml(obj.description)}</div>`
          : "";
      return `${title}${h}${d}`;
    }

    return `${title}<pre style="white-space:pre-wrap;">${escapeHtml(JSON.stringify(obj, null, 2))}</pre>`;
  }, []);

  const cleanupArtifacts = useCallback((html: string) => {
    let s = html || "";
    s = s.replace(/<p[^>]*>\s*\/\s*<\/p>/gi, "");
    s = s.replace(/<div[^>]*>\s*\/\s*<\/div>/gi, "");
    s = s.replace(/(<br\s*\/?>\s*){4,}/gi, "<br/><br/>");
    return s;
  }, []);

  const tableToHtml = useCallback(
    (t: TableShape, blockKey: string) => {
      const title = t.title
        ? `<div style="font-weight:700;margin:12px 0 6px;">${escapeHtml(String(t.title))}</div>`
        : "";

      const colCount = Array.isArray(t.columns) ? t.columns.length : 0;
      const colWidth = colCount > 0 ? Math.floor(100 / colCount) : 33;

      const colgroup = `<colgroup>${Array.from({ length: colCount || 3 })
        .map(() => `<col style="width:${colWidth}%;">`)
        .join("")}</colgroup>`;

      const thead = `<thead><tr>${(t.columns || [])
        .map((c) => `<th>${escapeHtml(String(c))}</th>`)
        .join("")}</tr></thead>`;

      const tbody = `<tbody>${(t.rows || [])
        .map(
          (r) =>
            `<tr>${(r || [])
              .map((cell) => `<td>${escapeHtml(String(cell ?? "")).replace(/\n/g, "<br/>")}</td>`)
              .join("")}</tr>`
        )
        .join("")}</tbody>`;

      return `
      <div data-block="${blockKey}">
        ${title}
        <table class="doc-table" data-block="${blockKey}">
          ${colgroup}
          ${thead}
          ${tbody}
        </table>
      </div>
    `;
    },
    []
  );

  const safeJsonParse = useCallback((input: any): PatchJson | null => {
    try {
      if (input === null || input === undefined) return null;

      if (typeof input === "object") {
        if (Array.isArray(input)) return null;
        return input as PatchJson;
      }

      let text = String(input);
      text = text.replace(/^\uFEFF/, "");
      text = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
      text = text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

      const candidates: string[] = [];
      let inStr = false;
      let esc = false;
      let depth = 0;
      let startIdx = -1;

      for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (inStr) {
          if (esc) esc = false;
          else if (ch === "\\") esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }

        if (ch === '"') {
          inStr = true;
          continue;
        }

        if (ch === "{") {
          if (depth === 0) startIdx = i;
          depth++;
          continue;
        }

        if (ch === "}") {
          if (depth > 0) depth--;
          if (depth === 0 && startIdx !== -1) {
            const slice = text.slice(startIdx, i + 1).trim();
            candidates.push(slice);
            startIdx = -1;
          }
        }
      }

      if (candidates.length === 0) {
        try {
          const parsed = JSON.parse(text);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
          return parsed as PatchJson;
        } catch {
          return null;
        }
      }

      for (let i = candidates.length - 1; i >= 0; i--) {
        try {
          const parsed = JSON.parse(candidates[i]);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
          return parsed as PatchJson;
        } catch {
          // continue
        }
      }

      return null;
    } catch {
      return null;
    }
  }, []);

  const normalizePatch = useCallback(
    (rawPatch: PatchJson, expectedKeys?: string[]): PatchJson | null => {
      if (!rawPatch || typeof rawPatch !== "object") return null;

      const out: PatchJson = {};

      if (Array.isArray(rawPatch.DELETE)) {
        const del = rawPatch.DELETE
          .map((x) => String(x || "").toUpperCase().trim())
          .filter((k) => k && (k.startsWith("TABLE_") || allowedKeySet.has(k)));
        if (del.length) out.DELETE = Array.from(new Set(del));
      }

      const exp =
        expectedKeys && expectedKeys.length
          ? expectedKeys.map((k) => k.toUpperCase().trim()).filter(Boolean)
          : [];

      const hasAnyExpectedAlready = exp.some(
        (k) => (rawPatch as any)[k] !== undefined || (rawPatch as any)[k.toLowerCase()] !== undefined
      );

      // 단일 섹션 생성인데 content로 오는 경우 -> 해당 섹션으로 매핑
      if (exp.length === 1 && !hasAnyExpectedAlready) {
        const target = exp[0];
        const maybeContent =
          typeof (rawPatch as any).content === "string"
            ? (rawPatch as any).content
            : typeof (rawPatch as any).CONTENT === "string"
            ? (rawPatch as any).CONTENT
            : "";

        if (maybeContent && allowedKeySet.has(target)) {
          out[target] = maybeContent;
        }
      }

      for (const [k0, v] of Object.entries(rawPatch)) {
        if (k0 === "DELETE") continue;
        const k = String(k0 || "").toUpperCase().trim();
        if (!k) continue;

        if (k.startsWith("TABLE_")) {
          out[k] = v;
          continue;
        }

        if (!allowedKeySet.has(k)) continue;
        out[k] = v;
      }

      const keys = Object.keys(out);
      if (keys.length === 0 || (keys.length === 1 && keys[0] === "DELETE" && !out.DELETE?.length)) {
        return null;
      }
      return out;
    },
    [allowedKeySet]
  );

  /** ---------------------------
   *  7) Placeholder 매칭 (braceGap)
   * --------------------------- */
  const buildPlaceholderRegex = useCallback((blockKey: string) => {
    const key = String(blockKey).trim();
    const gap = `(?:<[^>]*>|\\s|&nbsp;)*`;
    const pattern = key.split("").join(gap);
    const open = `\\{${gap}\\{`;
    const close = `\\}${gap}\\}`;
    return new RegExp(`${open}${gap}${pattern}${gap}${close}`, "gi");
  }, []);

  /** ---------------------------
   *  8) upsert / delete / apply patch
   * --------------------------- */
  const upsertBlock = useCallback(
    (currentHtml: string, key: string, value: any) => {
      let html = currentHtml || "";
      const blockKey = String(key).trim();

      if (value === null || value === undefined) value = "";

      if (blockKey.startsWith("TABLE_")) value = tryParseJsonLikeString(value);

      let rendered = "";

      if (
        blockKey.startsWith("TABLE_") &&
        typeof value === "object" &&
        value?.columns &&
        value?.rows
      ) {
        rendered = tableToHtml(value as TableShape, blockKey);
      } else {
        if (typeof value === "object") {
          rendered = `<div data-block="${blockKey}">${objectToDocHtml(value)}</div>`;
        } else {
          const text = String(value).replace(/\n/g, "<br/>");
          rendered = `<div data-block="${blockKey}">${text}</div>`;
        }
      }

      const placeholderRegex = buildPlaceholderRegex(blockKey);
      const replaced1 = html.replace(placeholderRegex, rendered);
      if (replaced1 !== html) return cleanupArtifacts(replaced1);

      const blockDivRegex = new RegExp(
        `<div\\s+data-block=["']${blockKey}["'][^>]*>[\\s\\S]*?<\\/div>`,
        "i"
      );
      const replaced2 = html.replace(blockDivRegex, rendered);
      if (replaced2 !== html) return cleanupArtifacts(replaced2);

      return cleanupArtifacts(`${html}<div style="margin-top:18px;"></div>${rendered}`);
    },
    [buildPlaceholderRegex, cleanupArtifacts, objectToDocHtml, tableToHtml, tryParseJsonLikeString]
  );

  const deleteBlock = useCallback(
    (currentHtml: string, key: string) => {
      let html = currentHtml || "";
      const blockKey = String(key).trim();

      const blockDivRegex = new RegExp(
        `<div\\s+data-block=["']${blockKey}["'][^>]*>[\\s\\S]*?<\\/div>`,
        "gi"
      );
      html = html.replace(blockDivRegex, "");

      const tableRegex = new RegExp(
        `<table[^>]*data-block=["']${blockKey}["'][\\s\\S]*?<\\/table>`,
        "gi"
      );
      html = html.replace(tableRegex, "");

      const placeholderRegex = buildPlaceholderRegex(blockKey);
      html = html.replace(placeholderRegex, "");

      return cleanupArtifacts(html);
    },
    [buildPlaceholderRegex, cleanupArtifacts]
  );

  const applyPatch = useCallback(
    (patch: PatchJson, source: "ai" | "user" = "ai", focusBlock?: string) => {
      setDocHTML((prev) => {
        let next = prev || "";

        if (Array.isArray(patch.DELETE)) {
          for (const k of patch.DELETE) next = deleteBlock(next, k);
        }

        let firstKey: string | undefined;
        for (const [k, v] of Object.entries(patch)) {
          if (k === "DELETE") continue;
          if (!firstKey) firstKey = k;
          next = upsertBlock(next, k, v);
        }

        if (frameReady) {
          const focus =
            focusBlock || firstKey || (Array.isArray(patch.DELETE) ? patch.DELETE[0] : undefined);
          sendHtmlToIframe(next, source, focus);
        }

        return next;
      });
    },
    [deleteBlock, frameReady, sendHtmlToIframe, upsertBlock]
  );

  /** ---------------------------
   *  9) iframe 메시지 수신
   * --------------------------- */
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (!ev.data?.__editor) return;

      if (ev.data.type === "EDIT_HTML") {
        setDocHTML(String(ev.data.html || ""));
      }
      if (ev.data.type === "FRAME_READY") {
        setFrameReady(true);
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  /** ---------------------------
   *  10) 템플릿 로드 (깜빡임 방지 가드 포함)
   * --------------------------- */
  const lastLoadedTemplateUrlRef = useRef<string | null>(null);
  const templateLoadingRef = useRef(false);

  useEffect(() => {
    const loadTemplate = async () => {
      if (!frameReady) return;

      // 같은 URL을 이미 로드했으면 다시 안 함(깜빡임 방지)
      if (lastLoadedTemplateUrlRef.current === templateUrl) return;
      if (templateLoadingRef.current) return;

      templateLoadingRef.current = true;

      const loadingHtml = `
        <div style="color:#334155;font-weight:800;">템플릿 로딩...</div>
        <div style="margin-top:8px;color:#475569;font-size:13px;line-height:1.6;">
          선택한 양식: <b>${escapeHtml(rawType)}</b><br/>
          템플릿 경로: <code>${escapeHtml(templateUrl)}</code>
        </div>
      `;

      setDocHTML(loadingHtml);
      sendHtmlToIframe(loadingHtml, "template");

      try {
        const res = await fetch(templateUrl, { cache: "no-store" });

        if (!res.ok) {
          const msg = `템플릿 로드 실패: ${templateUrl} (HTTP ${res.status})`;
          const html = `
            <div style="color:#b91c1c;font-weight:800;">${escapeHtml(msg)}</div>
            <div style="margin-top:10px;color:#334155;line-height:1.6;">
              public/templates 폴더에 <b>${escapeHtml(templateFileName)}.docx</b>가 있는지 확인하세요.<br/>
              브라우저에서 <code>${escapeHtml(templateUrl)}</code> 직접 열었을 때 다운로드되면 파일은 정상입니다.
            </div>
          `;
          setDocHTML(html);
          sendHtmlToIframe(html, "template");
          return;
        }

        const arrayBuffer = await res.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        const initial = normalizeTemplateHTML(result.value || "").trim();

        if (!initial) {
          const html = `
            <div style="color:#b91c1c;font-weight:800;">템플릿 변환 결과가 비어 있습니다.</div>
            <div style="margin-top:10px;color:#334155;">
              ${escapeHtml(templateFileName)}.docx가 빈 문서인지 확인하세요.
            </div>
          `;
          setDocHTML(html);
          sendHtmlToIframe(html, "template");
          return;
        }

        // 템플릿에서 토큰을 추출해 허용키를 보강
        const extracted = extractTokensFromHtml(initial);
        setTemplateExtractedTokens(extracted);

        setDocHTML(initial);
        sendHtmlToIframe(initial, "template");
        lastLoadedTemplateUrlRef.current = templateUrl;
      } catch (e) {
        console.error("템플릿 로드/변환 오류:", e);
        const html = `
          <div style="color:#b91c1c;font-weight:800;">템플릿 로드/변환 오류 발생</div>
          <div style="margin-top:10px;color:#334155;">
            콘솔(F12) 에러 로그를 확인하세요.
          </div>
        `;
        setDocHTML(html);
        sendHtmlToIframe(html, "template");
      } finally {
        templateLoadingRef.current = false;
      }
    };

    loadTemplate();
  }, [
    frameReady,
    templateUrl,
    templateFileName,
    rawType,
    normalizeTemplateHTML,
    sendHtmlToIframe,
    extractTokensFromHtml,
  ]);

  /** ---------------------------
   *  11) 피드백 타깃 추론(템플릿별 확장)
   * --------------------------- */
  const inferFeedback = useCallback((feedback: string) => {
    const f0 = feedback.replace(/\s+/g, "").toLowerCase();
    const targets: string[] = [];

    // 공통
    const tableKeyMatch = feedback.match(/TABLE_\d+/gi) || [];
    for (const tk of tableKeyMatch) targets.push(tk.toUpperCase());

    // 레포트/논문 공통 느낌
    if (f0.includes("서론") || f0.includes("introduction")) targets.push("INTRODUCTION");
    if (f0.includes("결론") || f0.includes("conclusion")) targets.push("CONCLUSION");
    if (f0.includes("참고문헌") || f0.includes("references")) targets.push("REFERENCES");
    if (f0.includes("부록") || f0.includes("appendix")) targets.push("APPENDIX");

    // 레포트
    if (f0.includes("목차") || f0.includes("toc")) targets.push("TOC");
    if (f0.includes("요약") || f0.includes("abstract")) targets.push("ABSTRACT");
    if (f0.includes("제목") || f0.includes("title")) targets.push("TITLE");
    if (f0.includes("본론1") || f0.includes("body_1")) targets.push("BODY_1");
    if (f0.includes("본론2") || f0.includes("body_2")) targets.push("BODY_2");
    if (f0.includes("본론3") || f0.includes("body_3")) targets.push("BODY_3");

    // 강의노트
    if (f0.includes("과목")) targets.push("COURSE");
    if (f0.includes("날짜")) targets.push("DATE");
    if (f0.includes("주제")) targets.push("TOPIC");
    if (f0.includes("강의자") || f0.includes("교수")) targets.push("LECTURER");
    if (f0.includes("키워드") || f0.includes("질문")) targets.push("CUES");
    if (f0.includes("노트") || f0.includes("필기")) targets.push("NOTES");
    if (f0.includes("학습목표")) targets.push("LEARNING_OBJECTIVES");
    if (f0.includes("핵심") || f0.includes("포인트")) targets.push("KEY_POINTS");
    if (f0.includes("개념") || f0.includes("용어")) targets.push("TERMS");
    if (f0.includes("예시") || f0.includes("문제") || f0.includes("풀이")) targets.push("EXAMPLES");
    if (f0.includes("추가확인")) targets.push("QUESTIONS");
    if (f0.includes("다음") || f0.includes("액션") || f0.includes("과제")) targets.push("NEXT_ACTIONS");
    if (f0.includes("요약")) targets.push("SUMMARY");

    // 실험보고서
    if (f0.includes("실험명")) targets.push("EXPERIMENT_NAME");
    if (f0.includes("실험일")) targets.push("EXPERIMENT_DATE");
    if (f0.includes("제출일")) targets.push("SUBMIT_DATE");
    if (f0.includes("목적") || f0.includes("objective")) targets.push("OBJECTIVE");
    if (f0.includes("이론") || f0.includes("배경")) targets.push("BACKGROUND");
    if (f0.includes("재료") || f0.includes("기기")) targets.push("MATERIALS_EQUIPMENT");
    if (f0.includes("방법") || f0.includes("절차")) targets.push("METHODS");
    if (f0.includes("원자료") || f0.includes("관찰")) targets.push("RAW_DATA");
    if (f0.includes("결과") || f0.includes("표") || f0.includes("그래프")) targets.push("PROCESSED_RESULTS");
    if (f0.includes("고찰") || f0.includes("discussion")) targets.push("DISCUSSION");

    const wantsRemoveTable =
      /표.*(없애|삭제|제거)/i.test(feedback) || /(table).*(remove|delete)/i.test(feedback);

    const wantsRewrite = /(다시|재작성|새로|rewrite)/i.test(feedback) && !wantsRemoveTable;

    return {
      targets: Array.from(new Set(targets.map((x) => x.toUpperCase()))),
      wantsRewrite,
      wantsRemoveTable,
    };
  }, []);

  /** ---------------------------
   *  12) generateSection (양식별 허용키 기반)
   * --------------------------- */
  const generateSection = useCallback(
    async (
      sectionName: string,
      extraRequest: string,
      context: string,
      currentData: Record<string, any>,
      focusBlock?: string
    ) => {
      setProgress(`${sectionName} 작성 중...`);

      const expectedKeys = sectionName
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: rawType,
          template: templateFileName,
          prompt: `
당신은 전문 문서 작성 AI입니다. 제공된 자료를 바탕으로 다음 항목을 작성하여 JSON으로 반환하세요.

[문서 종류]: ${rawType}
[작성 항목]: ${sectionName}

[매우 중요: 출력 키 제한]
- 반드시 아래 키만 사용하세요:
  ${expectedKeys.join(", ")}${expectedKeys.length ? ", " : ""}TABLE_1~TABLE_10, DELETE
- 위 목록에 없는 키(title, content 등) 출력 금지.

[작성 지침]
1) 한국어로 전문적으로 작성. (마크다운 금지)
2) JSON만 출력. (설명 문장 금지)
3) 자료에 없는 내용은 단정하지 말고 "자료에서 확인 불가"로 표기 가능.
4) 표는 마크다운 표(|---|) 금지. 반드시 TABLE_1~TABLE_10 키로만 출력.
5) APPENDIX는 반드시 문자열(string)만. APPENDIX에 객체/배열/표 금지.
6) "표 삭제" 요청이면 DELETE 키로 삭제 대상(TABLE_9 등)을 배열로 반환:
   { "DELETE": ["TABLE_9"] }
7) TABLE_*를 제외한 모든 키의 값은 반드시 문자열(string)만 출력하라. (객체/배열 금지)
8) ${expectedKeys.length === 1 ? `반드시 "${expectedKeys[0]}" 키에 내용을 넣어라.` : "각 항목 키에 해당 내용 문자열을 넣어라."}

[추가 요청사항]: ${extraRequest}

[자료]: ${context.substring(0, 9000)} ... (생략)
          `,
        }),
      });

      if (!res.ok) throw new Error("API Error");

      const data = await res.json();
      const raw = (data && (data.result ?? data.output ?? data.text ?? data.content)) ?? data;

      const parsed0 = safeJsonParse(raw);
      if (!parsed0) throw new Error("JSON Parse Fail");

      const parsed = normalizePatch(parsed0, expectedKeys);
      if (!parsed) throw new Error("JSON Patch Normalize Fail");

      const merged = { ...currentData, ...parsed };
      if (Array.isArray(parsed.DELETE)) {
        for (const k of parsed.DELETE) delete (merged as any)[k];
      }

      setFieldData(merged);
      applyPatch(parsed, "ai", focusBlock);
      return merged;
    },
    [applyPatch, normalizePatch, rawType, safeJsonParse, templateFileName]
  );

  /** ---------------------------
   *  13) PDF 업로드 -> 양식별 자동 작성 플로우
   * --------------------------- */
  const handleFileUpload = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      const file = files[0];
      if (fileInputRef.current) fileInputRef.current.value = "";

      setIsLoading(true);
      setMessages((prev) => [
        ...prev,
        { role: "ai", text: "PDF 분석 시작. 섹션별로 순차 작성합니다." },
      ]);

      let fullText = "";
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

        const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;

        const pages = [1, 2, 3, 4, 5, pdf.numPages - 1, pdf.numPages].filter(
          (p) => p > 0 && p <= pdf.numPages
        );

        for (const p of Array.from(new Set(pages))) {
          const page = await pdf.getPage(p);
          fullText += (await page.getTextContent()).items.map((it: any) => it.str).join(" ") + "\n";
        }

        setSourceText(fullText);
      } catch (err) {
        console.error(err);
        alert("PDF 읽기 실패");
        setIsLoading(false);
        setProgress("");
        return;
      }

      let current: Record<string, any> = { ...fieldData };

      try {
        // ✅ 양식별 자동 작성 플로우
        if (templateFileName === "lecture_note") {
          current = await generateSection(
            "COURSE, DATE, TOPIC, LECTURER, LEARNING_OBJECTIVES, KEY_POINTS",
            "과목/날짜/주제/강의자/학습목표/핵심 포인트를 작성하세요. 날짜는 자료에 없으면 '자료에서 확인 불가'로.",
            fullText,
            current
          );

          current = await generateSection(
            "CUES, NOTES, TERMS, EXAMPLES",
            "키워드/질문(CUES), 노트(NOTES), 개념/용어(TERMS), 예시/문제/풀이(EXAMPLES)를 구체적으로 작성하세요.",
            fullText,
            current
          );

          current = await generateSection(
            "SUMMARY, QUESTIONS, NEXT_ACTIONS",
            "요약(SUMMARY), 추가 확인 질문(QUESTIONS), 과제/다음 액션(NEXT_ACTIONS)을 작성하세요.",
            fullText,
            current
          );
        } else if (templateFileName === "lab_report") {
          current = await generateSection(
            "TITLE, COURSE, INSTRUCTOR, EXPERIMENT_NAME, EXPERIMENT_DATE, SUBMIT_DATE, DEPARTMENT, STUDENT_ID, STUDENT_NAME",
            "표지 정보(제목/과목/담당교수/실험명/실험일/제출일/학과/학번/이름)를 작성하세요. 모르면 '자료에서 확인 불가'.",
            fullText,
            current
          );

          current = await generateSection(
            "OBJECTIVE, BACKGROUND, MATERIALS_EQUIPMENT, METHODS",
            "실험 목적(OBJECTIVE), 이론/배경(BACKGROUND), 재료/기기(MATERIALS_EQUIPMENT), 방법(METHODS)을 작성하세요.",
            fullText,
            current
          );

          current = await generateSection(
            "RAW_DATA, PROCESSED_RESULTS, DISCUSSION, CONCLUSION, REFERENCES, APPENDIX",
            "원자료/관찰(RAW_DATA), 정리된 결과(PROCESSED_RESULTS), 고찰(DISCUSSION), 결론(CONCLUSION), 참고문헌(REFERENCES), 부록(APPENDIX)을 작성하세요. 표가 필요하면 TABLE_1~TABLE_3 사용.",
            fullText,
            current
          );
        } else if (templateFileName === "thesis") {
          current = await generateSection(
            "PAPER_TITLE_KO, PAPER_TITLE_EN, AUTHORS, AFFILIATIONS, ABSTRACT, KEYWORDS",
            "논문 메타 정보(국문/영문 제목, 저자, 소속, 초록, 키워드)를 작성하세요.",
            fullText,
            current
          );

          current = await generateSection(
            "INTRODUCTION, METHODS, RESULTS, DISCUSSION",
            "서론/연구방법/연구결과/논의를 작성하세요. 결과에 표가 필요하면 TABLE_1~TABLE_3 사용.",
            fullText,
            current
          );

          current = await generateSection(
            "CONCLUSION, REFERENCES, APPENDIX",
            "결론/참고문헌/부록을 작성하세요.",
            fullText,
            current
          );
        } else if (templateFileName === "review") {
          current = await generateSection(
            "TITLE, COURSE, INSTRUCTOR, SUBMIT_DATE, DEPARTMENT, STUDENT_ID, STUDENT_NAME, RESEARCH_QUESTION, SCOPE_DEFINITIONS",
            "문헌고찰 제목/과목/교수/제출일/학과/학번/이름 + 연구 질문/목적(RESEARCH_QUESTION)과 범위/정의(SCOPE_DEFINITIONS)를 작성하세요.",
            fullText,
            current
          );

          current = await generateSection(
            "DATABASES, SEARCH_QUERY, FILTERS, INCLUSION_CRITERIA, EXCLUSION_CRITERIA, SCREENING_LOG",
            "검색전략(데이터베이스/검색식/필터/포함기준/제외기준/스크리닝 기록)을 작성하세요.",
            fullText,
            current
          );

          current = await generateSection(
            "THEMES_SUMMARY, GAP_IMPLICATIONS, REFERENCES, APPENDIX",
            "테마 요약 및 종합(THEMES_SUMMARY), 연구 공백/시사점(GAP_IMPLICATIONS), 참고문헌, 부록을 작성하세요. 문헌요약표(PAPER_n_m)는 자료에 기반하여 가능한 범위에서 채우세요.",
            fullText,
            current
          );
        } else {
          // report 기본(네가 원래 잘 되던 레포트 플로우)
          current = await generateSection(
            "TITLE, ABSTRACT, TOC, INTRODUCTION",
            "제목/요약(10줄+)/목차/서론을 작성하세요.",
            fullText,
            current
          );

          current = await generateSection(
            "BODY_1",
            "첫 번째 핵심 주제로 본론1을 1000자 이상 작성. 필요 시 TABLE_1에 요약표.",
            fullText,
            current
          );

          current = await generateSection(
            "BODY_2",
            "두 번째 핵심 주제로 본론2를 1000자 이상 작성. 필요 시 TABLE_2에 비교표.",
            fullText,
            current
          );

          current = await generateSection(
            "BODY_3",
            "세 번째 핵심 주제로 본론3을 1000자 이상 작성. 필요 시 TABLE_3에 정리표.",
            fullText,
            current
          );

          current = await generateSection(
            "CONCLUSION, REFERENCES, APPENDIX, INSTRUCTOR, COURSE, DEPARTMENT, STUDENT_ID, STUDENT_NAME",
            "결론/참고문헌/부록(문장형)/신상정보(불명확하면 자료에서 확인 불가). 부록 표는 TABLE_9로.",
            fullText,
            current
          );
        }

        setMessages((prev) => [
          ...prev,
          { role: "ai", text: "완료. 오른쪽 문서에서 직접 수정도 가능합니다." },
        ]);
      } catch (err) {
        console.error(err);
        setMessages((prev) => [
          ...prev,
          { role: "ai", text: "생성 중 오류가 발생했습니다. 다시 시도해주세요." },
        ]);
      } finally {
        setIsLoading(false);
        setProgress("");
      }
    },
    [fieldData, generateSection, templateFileName]
  );

  /** ---------------------------
   *  14) 피드백 반영
   * --------------------------- */
  const handleFeedback = useCallback(async () => {
    const feedback = userInput.trim();
    if (!feedback) return;

    setUserInput("");
    setMessages((prev) => [...prev, { role: "user", text: feedback }]);
    setIsLoading(true);
    setProgress("피드백 반영 중...");

    try {
      const { targets, wantsRewrite, wantsRemoveTable } = inferFeedback(feedback);

      if (wantsRewrite && targets.length === 1 && sourceText.trim()) {
        const section = targets[0];
        await generateSection(
          section,
          `사용자 피드백을 반영하여 ${section}을(를) 새로 작성하세요. 피드백: ${feedback}`,
          sourceText,
          { ...fieldData },
          section
        );
        setMessages((prev) => [...prev, { role: "ai", text: "반영 완료. 오른쪽 문서에서 확인해보세요." }]);
        return;
      }

      const hintedDeletes: string[] = [];

      if (wantsRemoveTable) {
        const explicit = feedback.match(/TABLE_\d+/gi) || [];
        for (const k of explicit) hintedDeletes.push(k.toUpperCase());
      }

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: rawType,
          template: templateFileName,
          prompt: `
당신은 "문서 수정 패치" 생성기입니다. 사용자의 피드백을 문서에 적용하기 위해 JSON 패치를 만들어야 합니다.

[문서 종류]: ${rawType}
[사용자 피드백]: ${feedback}

[허용 키 목록(중요)]:
${AVAILABLE_KEYS.join(", ")}

[규칙]
1) 응답은 JSON만.
2) 수정할 항목은 해당 키로 값을 주고,
3) 삭제할 항목은 DELETE 배열로 키를 지정.
   예: { "DELETE": ["TABLE_9"] }
4) 표는 TABLE_*만 사용(객체 형태). APPENDIX는 반드시 문자열.
5) "표 삭제" 요청이면 반드시 DELETE에 TABLE_*를 넣어라.
6) TABLE_*를 제외한 모든 키 값은 반드시 문자열(string)만. 객체/배열 금지.

[참고: 표 삭제 후보(TABLE_*)]
${hintedDeletes.length ? Array.from(new Set(hintedDeletes)).join(", ") : "없음"}

[출력 예시]
{
  "DELETE": ["TABLE_9"],
  "NOTES": "수정된 노트..."
}
          `,
        }),
      });

      const data = await res.json();
      const raw = (data && (data.result ?? data.output ?? data.text ?? data.content)) ?? data;

      const parsed0 = safeJsonParse(raw);
      if (!parsed0) {
        setMessages((prev) => [
          ...prev,
          { role: "ai", text: "피드백을 JSON으로 해석하지 못했습니다. 더 구체적으로 말해줘요." },
        ]);
        return;
      }

      const parsed = normalizePatch(parsed0);
      if (!parsed) {
        setMessages((prev) => [
          ...prev,
          { role: "ai", text: "피드백 패치가 비어있거나 형식이 올바르지 않습니다. 다시 말해줘요." },
        ]);
        return;
      }

      if (wantsRemoveTable && hintedDeletes.length) {
        const del = new Set<string>(
          Array.isArray(parsed.DELETE) ? parsed.DELETE.map((x) => String(x).toUpperCase()) : []
        );
        for (const k of hintedDeletes) del.add(k.toUpperCase());
        parsed.DELETE = Array.from(del);
      }

      const merged = { ...fieldData, ...parsed };
      if (Array.isArray(parsed.DELETE)) {
        for (const k of parsed.DELETE) delete (merged as any)[k];
      }
      setFieldData(merged);

      const focusBlock =
        targets.find((t) => t && !t.startsWith("TABLE_")) ||
        (Array.isArray(parsed.DELETE) ? parsed.DELETE[0] : undefined);

      applyPatch(parsed, "ai", focusBlock);

      setMessages((prev) => [...prev, { role: "ai", text: "반영 완료. 오른쪽 문서에서 확인해보세요." }]);
    } catch (e) {
      console.error(e);
      setMessages((prev) => [...prev, { role: "ai", text: "통신 오류로 반영에 실패했습니다." }]);
    } finally {
      setIsLoading(false);
      setProgress("");
    }
  }, [
    AVAILABLE_KEYS,
    applyPatch,
    fieldData,
    generateSection,
    inferFeedback,
    normalizePatch,
    rawType,
    safeJsonParse,
    sourceText,
    templateFileName,
    userInput,
  ]);

  /** ---------------------------
   *  15) iframe srcDoc
   * --------------------------- */
  const iframeSrcDoc = useMemo(() => {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <style>
    body { margin:0; background:#eef2f6; }
    #page {
      width: 850px;
      min-height: 1100px;
      margin: 24px auto;
      background: white;
      box-shadow: 0 10px 30px rgba(0,0,0,0.12);
      border-radius: 8px;
      overflow: hidden;
    }
    #editor {
      padding: 80px 90px;
      font-family: 'Malgun Gothic', sans-serif;
      line-height: 1.8;
      font-size: 15px;
      color:#111;
      outline: none;
      min-height: 1100px;
    }
    table.doc-table {
      border-collapse: collapse;
      width: 100%;
      border: 1.5px solid #111;
      margin: 10px 0 22px;
      table-layout: fixed;
    }
    table.doc-table th, table.doc-table td {
      border: 1px solid #111;
      padding: 12px;
      vertical-align: top;
      word-break: keep-all;
      overflow-wrap: anywhere;
    }
    table.doc-table th { font-weight: 700; background: #f3f4f6; }
    #editor:focus { background:#fcfcfc; }
  </style>
</head>
<body>
  <div id="page">
    <div id="editor" contenteditable="true" spellcheck="false">양식을 불러오는 중...</div>
  </div>

  <script>
    const editor = document.getElementById('editor');
    window.parent.postMessage({ __editor:true, type:'FRAME_READY' }, '*');

    let t = null;
    editor.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        window.parent.postMessage({ __editor:true, type:'EDIT_HTML', html: editor.innerHTML }, '*');
      }, 350);
    });

    window.addEventListener('message', (ev) => {
      const d = ev.data;
      if (!d || !d.__editor) return;

      if (d.type === 'SET_HTML') {
        const prevScroll = document.scrollingElement ? document.scrollingElement.scrollTop : 0;
        editor.innerHTML = d.html || "";

        setTimeout(() => {
          if (d.focusBlock) {
            const el = editor.querySelector(`[data-block="${d.focusBlock}"]`);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              const prevOutline = el.style.outline;
              const prevBg = el.style.backgroundColor;
              el.style.outline = "3px solid #2563eb";
              el.style.backgroundColor = "#eff6ff";
              setTimeout(() => {
                el.style.outline = prevOutline;
                el.style.backgroundColor = prevBg;
              }, 900);
              return;
            }
          }
          if (document.scrollingElement) document.scrollingElement.scrollTop = prevScroll;
        }, 0);
      }
    });
  </script>
</body>
</html>
    `;
  }, []);

  /** ---------------------------
   *  16) UI
   * --------------------------- */
  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh", backgroundColor: "#f3f4f6", overflow: "hidden" }}>
      <aside style={{ width: 380, backgroundColor: "#fff", borderRight: "1px solid #ddd", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: 20, backgroundColor: "#1e40af", color: "white", fontWeight: "bold" }}>
          AI WORD EDITOR
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 15, fontSize: 13 }}>
          <div style={{ marginBottom: 10, color: "#475569", lineHeight: 1.6 }}>
            상태: {frameReady ? "편집기 준비됨" : "편집기 준비 중"}<br />
            선택한 양식: <b>{rawType}</b><br />
            템플릿: <code>{templateUrl}</code><br />
            허용 필드 수: <b>{AVAILABLE_KEYS.length}</b> / 표키: TABLE_1~TABLE_10
          </div>

          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                marginBottom: 10,
                padding: 12,
                borderRadius: 10,
                background: m.role === "user" ? "#eff6ff" : "#f8fafc",
                border: "1px solid #e2e8f0",
                color: "#0f172a",
                lineHeight: 1.6,
              }}
            >
              {m.text}
            </div>
          ))}

          {isLoading && (
            <div style={{ padding: 10, fontSize: 12, color: "#e11d48", fontWeight: "bold" }}>
              {progress ? `처리 중: ${progress}` : "처리 중..."}
            </div>
          )}
        </div>

        <div style={{ padding: 15, borderTop: "1px solid #eee", backgroundColor: "#f9fafb" }}>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".pdf,application/pdf"
            style={{ display: "none" }}
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              width: "100%",
              padding: 12,
              marginBottom: 10,
              backgroundColor: "#1e40af",
              color: "white",
              border: "none",
              borderRadius: 8,
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            PDF 업로드(자동 채움)
          </button>

          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleFeedback()}
              placeholder="예: NOTES 더 자세히 / OBJECTIVE 다시써줘 / SUMMARY 짧게 / TABLE_2 삭제"
              style={{
                flex: 1,
                padding: 12,
                border: "1px solid #cbd5e1",
                borderRadius: 8,
                fontSize: 13,
                outline: "none",
              }}
            />
            <button
              onClick={handleFeedback}
              style={{
                padding: "0 16px",
                backgroundColor: "#0f172a",
                color: "white",
                border: "none",
                borderRadius: 8,
                fontWeight: "bold",
                cursor: "pointer",
              }}
            >
              적용
            </button>
          </div>
        </div>
      </aside>

      <main style={{ flex: 1, overflowY: "auto", padding: 18 }}>
        <iframe ref={iframeRef} srcDoc={iframeSrcDoc} style={{ width: "100%", height: "100%", border: "none" }} />
      </main>
    </div>
  );
}
