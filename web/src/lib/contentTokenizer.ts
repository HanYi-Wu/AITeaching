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

/** 从 startIndex 开始扫描，找到匹配 delimiter 的结束位置。-1 表示未找到。 */
function findEndOfMath(
  delimiter: string,
  text: string,
  startIndex: number,
  images: ImageReplacement[],
  startImageIndex: number,
): number {
  let index = startIndex;
  let braceLevel = 0;
  let imageIndex = startImageIndex;
  while (index < text.length) {
    const image = images[imageIndex];
    if (image && index >= image.start && index < image.end) {
      index = image.end;
      imageIndex += 1;
      continue;
    }
    while (images[imageIndex] && images[imageIndex].end <= index) imageIndex += 1;
    const nextImage = images[imageIndex];
    if (braceLevel <= 0 && text.startsWith(delimiter, index) &&
      (!nextImage || index + delimiter.length <= nextImage.start)) {
      return index;
    }
    const ch = text[index];
    if (ch === "\\") {
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

const DELIMITER_BY_LEFT = new Map(DELIMITERS.map((d) => [d.left, d]));
const LEFT_DELIMITER_RE = new RegExp(
  DELIMITERS.map((delimiter) => escapeRegex(delimiter.left)).join("|"),
  "g",
);

/* ── Mermaid / 图片占位符提取 ── */

const DIAGRAM_FENCE_RE = /```(mermaid|primebrush|solaire-table)\s*\n([\s\S]*?)```/g;
const IMAGE_PLACEHOLDER_RE = /:::((?:PRIMEBRUSH|MERMAID|EMBED)_IMG):([^:]+):::/g;

type SavedBlock =
  | { kind: "mermaid"; source: string; raw: string }
  | { kind: "table"; source: string; raw: string }
  | { kind: "protectedText"; raw: string }
  | { kind: "image"; imgKind: string; path: string; raw: string };

interface ImageReplacement {
  start: number;
  end: number;
  sentinel: string;
  block: Extract<SavedBlock, { kind: "image" }>;
}

/** sentinel 前缀不含任何 LaTeX 特殊字符，可安全嵌入正文 */
const SENTINEL_PRE = "\x00BLK";
const SENTINEL_SUF = "\x00";
const SENTINEL_RE = new RegExp(
  `${escapeRegex(SENTINEL_PRE)}(\\d+)${escapeRegex(SENTINEL_SUF)}`,
  "g",
);

function findNextLeftDelimiter(
  text: string,
  start: number,
  end: number,
): { index: number; delimiter: Delimiter } | null {
  // Bound the native regex to this visible span. Without the slice, a delimiter
  // after each virtual image can be rescanned once per preceding image.
  const hasBound = end !== text.length;
  const visibleText = hasBound ? text.slice(start, end) : text;
  LEFT_DELIMITER_RE.lastIndex = hasBound ? 0 : start;
  const match = LEFT_DELIMITER_RE.exec(visibleText);
  if (!match) return null;
  return {
    index: (hasBound ? start : 0) + match.index,
    delimiter: DELIMITER_BY_LEFT.get(match[0])!,
  };
}

function collectImageReplacements(text: string, saved: SavedBlock[]): ImageReplacement[] {
  const replacements: ImageReplacement[] = [];
  IMAGE_PLACEHOLDER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMAGE_PLACEHOLDER_RE.exec(text)) !== null) {
    const index = saved.length;
    const block = {
      kind: "image" as const,
      imgKind: match[1],
      path: match[2],
      raw: match[0],
    };
    saved.push(block);
    replacements.push({
      start: match.index,
      end: IMAGE_PLACEHOLDER_RE.lastIndex,
      sentinel: `${SENTINEL_PRE}${index}${SENTINEL_SUF}`,
      block,
    });
  }
  return replacements;
}

function emitSavedBlock(tokens: ContentToken[], block: SavedBlock | undefined): void {
  if (!block) return;
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

function emitSavedText(
  tokens: ContentToken[],
  text: string,
  start: number,
  end: number,
  saved: SavedBlock[],
): void {
  if (start >= end) return;
  const segment = text.slice(start, end);
  if (!segment.includes(SENTINEL_PRE)) {
    tokens.push({ type: "text", content: segment });
    return;
  }
  let cursor = 0;
  SENTINEL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SENTINEL_RE.exec(segment)) !== null) {
    if (match.index > cursor) {
      tokens.push({ type: "text", content: segment.slice(cursor, match.index) });
    }
    emitSavedBlock(tokens, saved[Number(match[1])]);
    cursor = SENTINEL_RE.lastIndex;
  }
  SENTINEL_RE.lastIndex = 0;
  if (cursor < segment.length) tokens.push({ type: "text", content: segment.slice(cursor) });
}

function emitTextWithImages(
  tokens: ContentToken[],
  text: string,
  start: number,
  end: number,
  saved: SavedBlock[],
  images: ImageReplacement[],
  startImageIndex: number,
): number {
  let cursor = start;
  let imageIndex = startImageIndex;
  while (images[imageIndex] && images[imageIndex].end <= start) imageIndex += 1;
  while (images[imageIndex] && images[imageIndex].start < end) {
    const image = images[imageIndex];
    if (image.start > cursor) emitSavedText(tokens, text, cursor, image.start, saved);
    emitSavedBlock(tokens, image.block);
    cursor = image.end;
    imageIndex += 1;
  }
  if (cursor < end) emitSavedText(tokens, text, cursor, end, saved);
  return imageIndex;
}

function virtualSlice(
  text: string,
  start: number,
  end: number,
  images: ImageReplacement[],
  startImageIndex: number,
): string {
  let imageIndex = startImageIndex;
  while (images[imageIndex] && images[imageIndex].end <= start) imageIndex += 1;
  if (!images[imageIndex] || images[imageIndex].start >= end) return text.slice(start, end);

  const pieces: string[] = [];
  let cursor = start;
  while (images[imageIndex] && images[imageIndex].start < end) {
    const image = images[imageIndex];
    if (image.start > cursor) pieces.push(text.slice(cursor, image.start));
    pieces.push(image.sentinel);
    cursor = image.end;
    imageIndex += 1;
  }
  if (cursor < end) pieces.push(text.slice(cursor, end));
  return pieces.join("");
}

function tokenizeProtectedText(
  text: string,
  saved: SavedBlock[],
  images: ImageReplacement[],
): ContentToken[] {
  const tokens: ContentToken[] = [];
  let cursor = 0;
  let imageIndex = 0;
  while (cursor < text.length) {
    while (images[imageIndex] && images[imageIndex].end <= cursor) imageIndex += 1;
    const nextImage = images[imageIndex];
    const segmentEnd = nextImage?.start ?? text.length;
    const found = findNextLeftDelimiter(text, cursor, segmentEnd);

    if (!found) {
      if (nextImage) {
        if (nextImage.start > cursor) emitSavedText(tokens, text, cursor, nextImage.start, saved);
        emitSavedBlock(tokens, nextImage.block);
        cursor = nextImage.end;
        imageIndex += 1;
        continue;
      }
      emitSavedText(tokens, text, cursor, text.length, saved);
      break;
    }

    const { index: start, delimiter } = found;
    if (start > cursor) emitSavedText(tokens, text, cursor, start, saved);
    const mathStart = start + delimiter.left.length;
    const end = findEndOfMath(delimiter.right, text, mathStart, images, imageIndex);
    if (end === -1) {
      emitTextWithImages(tokens, text, start, text.length, saved, images, imageIndex);
      break;
    }

    const afterMath = end + delimiter.right.length;
    const latex = delimiter.left.startsWith("\\begin{")
      ? virtualSlice(text, start, afterMath, images, imageIndex)
      : virtualSlice(text, mathStart, end, images, imageIndex);
    tokens.push({ type: delimiter.display ? "displayMath" : "inlineMath", latex });
    cursor = afterMath;
    while (images[imageIndex] && images[imageIndex].end <= cursor) imageIndex += 1;
  }
  return tokens;
}

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

  // Read image placeholders as virtual sentinels while scanning. This keeps
  // them opaque to math delimiters without allocating another full copy.
  const imageReplacements = collectImageReplacements(processed, saved);
  return tokenizeProtectedText(processed, saved, imageReplacements);
}
