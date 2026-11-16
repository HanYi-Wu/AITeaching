/**
 * 前端 TeX 安全校验（与 Python 侧 `math_fragment_check.py` 对齐）。
 *
 * 利用 `tokenizeContent` 的解析结果：仅对 `text` 类型的 token 扫描特殊字符，
 * 避免在数学模式内误报正常的 `_`、`^` 等。
 *
 * 分级策略：
 *   error  — 几乎必定导致 XeLaTeX 编译失败
 *   warning — 可能有问题，但有合理使用场景
 */

import { tokenizeContent } from "./contentTokenizer";

export type LintSeverity = "error" | "warning";

export interface MathLintResult {
  code: string;
  severity: LintSeverity;
  message: string;
}

/* ── 正文（非数学模式）中的特殊字符扫描 ── */

interface CharRule {
  char: string;
  code: string;
  severity: LintSeverity;
  message: string;
}

const CHAR_RULES: CharRule[] = [
  {
    char: "%",
    code: "latex_percent",
    severity: "error",
    message:
      "正文（非数学模式）中出现未转义的 `%`，XeLaTeX 会将其视为注释起始，导致该行后续内容被忽略。请改为 `\\%`。",
  },
  {
    char: "_",
    code: "latex_underscore",
    severity: "warning",
    message:
      "正文（非数学模式）中出现下划线 `_`，XeLaTeX 在数学模式外会报错。如果是填空横线，请用 `\\_` 或 `\\underline{...}`；如果是变量名下标，请用 `$x_1$`。",
  },
  {
    char: "^",
    code: "latex_caret",
    severity: "warning",
    message:
      "正文（非数学模式）中出现 `^`，XeLaTeX 在数学模式外会报错。如需上标，请用 `$x^2$`；如需音调符号，请用 `\\^{}`。",
  },
];

function stripFencedCodeBlocks(text: string): string {
  if (!text.includes("```")) return text;

  const out: string[] = [];
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^[ \t]{0,3}```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) out.push(line);
  }
  return out.join("\n");
}

/**
 * 扫描单个正文片段（已确认在数学模式外），检测危险字符。
 * `\\` 开头视为转义序列，跳过下一个字符。
 */
function scanTextSegment(
  text: string,
  seen: Set<string>,
  results: MathLintResult[],
): void {
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\\" && i + 1 < text.length) {
      i += 2;
      continue;
    }
    for (const rule of CHAR_RULES) {
      if (text[i] === rule.char && !seen.has(rule.code)) {
        results.push({ code: rule.code, severity: rule.severity, message: rule.message });
        seen.add(rule.code);
      }
    }
    i++;
  }
}

/* ── $/$$ 定界符平衡检查（在 tokenizeContent 之前，用于检测未匹配的 $） ── */

function countUnescapedDollars(text: string, start: number, end: number): number {
  let count = 0;
  let index = start;
  while (index < end) {
    if (text[index] === "\\" && index + 1 < end) {
      index += 2;
      continue;
    }
    if (text[index] === "$") count += 1;
    index += 1;
  }
  return count;
}

function checkDollarBalance(text: string): MathLintResult[] {
  const results: MathLintResult[] = [];

  // Search display pairs natively, then scan only the text outside them.
  let displayCount = 0;
  let inlineOdd = false;
  let outsideStart = 0;
  let searchFrom = 0;
  while (true) {
    const pairStart = text.indexOf("$$", searchFrom);
    if (pairStart === -1) break;
    displayCount += 1;
    if (displayCount % 2 === 1) {
      if (countUnescapedDollars(text, outsideStart, pairStart) % 2 !== 0) inlineOdd = true;
    } else {
      outsideStart = pairStart + 2;
    }
    searchFrom = pairStart + 2;
  }

  if (displayCount % 2 !== 0) {
    results.push({
      code: "math_delimiter_display",
      severity: "error",
      message: "`$$` 出现次数为奇数，存在未闭合的显示公式。",
    });
    return results; // 严重不平衡，不再做行内检查
  }

  if (countUnescapedDollars(text, outsideStart, text.length) % 2 !== 0) inlineOdd = true;
  if (inlineOdd) {
    results.push({
      code: "math_delimiter_inline",
      severity: "error",
      message: "行内公式 `$...$` 定界符不成对，存在未闭合的行内公式。",
    });
  }

  return results;
}

/* ── 主入口 ── */

/**
 * 对题目内容字符串做 TeX 安全校验，返回分级问题列表。
 *
 * 利用 `tokenizeContent` 的解析结果：只对 `text` 类型 token 的内容扫描特殊字符，
 * 保证数学模式内的 `_`、`^` 等不会误报。
 */
export function lintMathContent(text: string): MathLintResult[] {
  if (!text) return [];

  const results: MathLintResult[] = [];
  const lintText = stripFencedCodeBlocks(text);

  // 1. 定界符平衡检查（基于原始文本，不依赖 tokenizer）
  if (lintText.includes("$")) {
    results.push(...checkDollarBalance(lintText));
  }

  // 如果定界符严重不平衡，tokenizer 可能产生奇怪结果，仍然做特殊字符扫描
  // （tokenizer 会尽力解析，text token 中的内容仍是可靠的正文区域）

  // 2. 正文（非数学模式）中的危险字符扫描
  const tokens = tokenizeContent(lintText);
  const seen = new Set<string>();

  for (const token of tokens) {
    if (token.type === "text") {
      scanTextSegment(token.content, seen, results);
    }
    // inlineMath / displayMath / mermaid / image 中的特殊字符不报告
    if (seen.size >= CHAR_RULES.length) break; // 每种规则至多报一次
  }

  return results;
}
