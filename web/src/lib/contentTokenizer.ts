/**
 * 统一内容分词器。
 *
 * 算法来自 KaTeX `splitAtDelimiters`（已内联以避免私有 API 依赖），
 * 核心是状态机式扫描：正确处理 `\` 转义与 `{}` 嵌套，允许 `$` 跨行（与 TeX 一致）。
 *
 * 在此基础上扩展 Mermaid 围栏块和图片占位符的解析：
 *   1. 先将 Mermaid 围栏 / `:::…_IMG:…:::` 占位符替换为 sentinel，防止被数学解析器误处理。
 *   2. 对剩余文本做状态机分词（$$ 优先于 $，AMS 环境作为 displayMath）。
 *   3. 将 sentinel 还原为对应的 mermaid / image token。
 */

export type ContentToken =
  | { type: "text"; content: string }
  | { type: "inlineMath"; latex: string }
  | { type: "displayMath"; latex: string }
  | { type: "mermaid"; source: string; raw: string }
  | { type: "image"; kind: string; path: string; raw: string }
  | { type: "table"; source: string; raw: string };

/* ── delimiter 列表（顺序重要：$$ 必须排在 $ 前面） ── */

interface Delimiter {
  left: string;
  right: string;
  display: boolean;
}

const DELIMITERS: Delimiter[] = [
  { left: "$$", right: "$$", display: true },
  { left: "\\[", right: "\\]", display: true },
  { left: "\\begin{equation}", right: "\\end{equation}", display: true },
  { left: "\\begin{equation*}", right: "\\end{equation*}", display: true },
  { left: "\\begin{align}", right: "\\end{align}", display: true },
  { left: "\\begin{align*}", right: "\\end{align*}", display: true },
  { left: "\\begin{gather}", right: "\\end{gather}", display: true },
  { left: "\\begin{gather*}", right: "\\end{gather*}", display: true },
  { left: "\\begin{cases}", right: "\\end{cases}", display: true },
  { left: "\\(", right: "\\)", display: false },
  { left: "$", right: "$", display: false },
];

/* ── 内联 splitAtDelimiters（源自 KaTeX contrib/auto-render/splitAtDelimiters） ── */

interface MathPart {
  type: "text" | "math";
  data: string;
  display?: boolean;
}

/** 从 startIndex 开始扫描，找到匹配 delimiter 的结束位置。-1 表示未找到。 */
function findEndOfMath(delimiter: string, text: string, startIndex: number): number {
  let index = startIndex;
  let braceLevel = 0;
  while (index < text.length) {
    const ch = text[index];
    if (braceLevel <= 0 && text.startsWith(delimiter, index)) {
      return index;
    } else if (ch === "\\") {
      index++;
    } else if (ch === "{") {
      braceLevel++;
    } else if (ch === "}") {
      braceLevel--;
    }
    index++;
  }
  return -1;
}

function escapeRegex(s: string): string {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

const AMS_RE = /^\\begin\{/;

const LEFT_DELIMITER_RE = new RegExp(
  "(" + DELIMITERS.map((d) => escapeRegex(d.left)).join("|") + ")",
  "g",
);
const DELIMITER_BY_LEFT = new Map(DELIMITERS.map((d) => [d.left, d]));

function splitAtDelimiters(text: string): MathPart[] {
  const parts: MathPart[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    LEFT_DELIMITER_RE.lastIndex = cursor;
    const match = LEFT_DELIMITER_RE.exec(text);
    if (!match) {
      parts.push({ type: "text", data: text.slice(cursor) });
      break;
    }
    const start = match.index;
    if (start > cursor) {
      parts.push({ type: "text", data: text.slice(cursor, start) });
    }
    const delimiter = DELIMITER_BY_LEFT.get(match[0])!;
    const mathStart = start + delimiter.left.length;
    const end = findEndOfMath(delimiter.right, text, mathStart);
    if (end === -1) {
      parts.push({ type: "text", data: text.slice(start) });
      break;
    }
    cursor = end + delimiter.right.length;
    const rawData = text.slice(start, cursor);
    parts.push({
      type: "math",
      data: AMS_RE.test(rawData) ? rawData : text.slice(mathStart, end),
      display: delimiter.display,
    });
  }
  return parts;
}

/* ── Mermaid / 图片占位符提取 ── */

const DIAGRAM_FENCE_RE = /```(mermaid|primebrush|solaire-table)\s*\n([\s\S]*?)```/g;
const IMAGE_PLACEHOLDER_RE = /:::((?:PRIMEBRUSH|MERMAID|EMBED)_IMG):([^:]+):::/g;

type SavedBlock =
  | { kind: "mermaid"; source: string; raw: string }
  | { kind: "table"; source: string; raw: string }
  | { kind: "protectedText"; raw: string }
  | { kind: "image"; imgKind: string; path: string; raw: string };

/** sentinel 前缀不含任何 LaTeX 特殊字符，可安全嵌入正文 */
const SENTINEL_PRE = "\x00BLK";
const SENTINEL_SUF = "\x00";

/* ── 主入口 ── */

export function tokenizeContent(value: string): ContentToken[] {
  const saved: SavedBlock[] = [];

  let processed = value;

  // 先提取 Mermaid / PrimeBrush 围栏（内部可能含 $ 号）
  DIAGRAM_FENCE_RE.lastIndex = 0;
  processed = processed.replace(DIAGRAM_FENCE_RE, (_full: string, kind: string, source: string) => {
    const idx = saved.length;
    if (kind === "mermaid") {
      saved.push({ kind: "mermaid", source, raw: _full });
    } else if (kind === "solaire-table") {
      saved.push({ kind: "table", source, raw: _full });
    } else {
      saved.push({ kind: "protectedText", raw: _full });
    }
    return `${SENTINEL_PRE}${idx}${SENTINEL_SUF}`;
  });

  // 再提取图片占位符
  IMAGE_PLACEHOLDER_RE.lastIndex = 0;
  processed = processed.replace(
    IMAGE_PLACEHOLDER_RE,
    (_full: string, imgKind: string, path: string) => {
      const idx = saved.length;
      saved.push({ kind: "image", imgKind, path, raw: _full });
      return `${SENTINEL_PRE}${idx}${SENTINEL_SUF}`;
    },
  );

  const parts = splitAtDelimiters(processed);

  const tokens: ContentToken[] = [];
  const sentinelRe = new RegExp(
    `${escapeRegex(SENTINEL_PRE)}(\\d+)${escapeRegex(SENTINEL_SUF)}`,
    "g",
  );

  for (const part of parts) {
    if (part.type === "math") {
      if (part.display) {
        tokens.push({ type: "displayMath", latex: part.data });
      } else {
        tokens.push({ type: "inlineMath", latex: part.data });
      }
    } else {
      // text segment — 可能包含 sentinel
      const seg = part.data;
      let last = 0;
      sentinelRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = sentinelRe.exec(seg)) !== null) {
        if (m.index > last) {
          tokens.push({ type: "text", content: seg.slice(last, m.index) });
        }
        const block = saved[Number(m[1])];
        if (block) {
          if (block.kind === "mermaid") {
            tokens.push({ type: "mermaid", source: block.source, raw: block.raw });
          } else if (block.kind === "table") {
            tokens.push({ type: "table", source: block.source, raw: block.raw });
          } else if (block.kind === "protectedText") {
            tokens.push({ type: "text", content: block.raw });
          } else {
            tokens.push({ type: "image", kind: block.imgKind, path: block.path, raw: block.raw });
          }
        }
        last = sentinelRe.lastIndex;
      }
      if (last < seg.length) {
        tokens.push({ type: "text", content: seg.slice(last) });
      }
    }
  }

  return tokens;
}
