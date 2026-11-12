"""Static checks on math delimiters and LaTeX plain-text hazards."""

from __future__ import annotations

import re
import sys
from collections import OrderedDict
from collections.abc import Iterator
from threading import Lock
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from solaire.exam_compiler.loaders.questions import LoadedQuestions

from solaire.exam_compiler.models import BankRecord, QuestionGroupRecord, QuestionItem

# Scanner modes: normal text, inline math, display math.
_OUT, _IN, _DISP = "out", "in", "disp"
_FENCE_LINE_RE = re.compile(r"^[ \t]{0,3}```")
_PLAIN_SPECIAL_RE = re.compile(r"[_^%]")
_UNESCAPED_DOLLAR_RE = re.compile(r"\\[\s\S]|\$")
_MATH_SCAN_EVENT_RE = re.compile(r"[\\$^_%]")
_MATH_SCAN_CACHE_MAX_ENTRIES = 16_384
_MATH_SCAN_CACHE_MAX_BYTES = 8 * 1024 * 1024
_MATH_SCAN_CACHE: OrderedDict[
    str,
    tuple[tuple[tuple[str, str], ...], tuple[str, ...], int],
] = OrderedDict()
_MATH_SCAN_CACHE_BYTES = 0
_MATH_SCAN_CACHE_LOCK = Lock()


def _strip_fenced_code_blocks(text: str) -> str:
    """Remove Markdown triple-backtick fenced blocks before TeX linting."""
    if "```" not in text:
        return text

    out: list[str] = []
    in_fence = False
    for line in text.splitlines(keepends=True):
        if _FENCE_LINE_RE.match(line):
            in_fence = not in_fence
            continue
        if not in_fence:
            out.append(line)
    return "".join(out)


def _collect_text_fields(rec: BankRecord) -> Iterator[tuple[str, str]]:
    """Yield checked text fields without materializing a group's flattened rows."""
    if isinstance(rec, QuestionItem):
        if (rec.content or "").strip():
            yield "content", rec.content
        if (rec.answer or "").strip():
            yield "answer", rec.answer
        if (rec.analysis or "").strip():
            yield "analysis", rec.analysis
        if rec.options:
            for k, v in rec.options.items():
                if (v or "").strip():
                    yield f"option_{k}", v
        return
    if isinstance(rec, QuestionGroupRecord):
        if (rec.material or "").strip():
            yield "material", rec.material
        for row in rec.iter_projected_rows():
            yield from row.iter_text_fields()


def _unescaped_dollar_count(seg: str) -> int:
    return sum(match.group() == "$" for match in _UNESCAPED_DOLLAR_RE.finditer(seg))


def _check_dollar_balance(text: str) -> list[str]:
    """Detect unbalanced $ / $$ delimiters, ignoring escaped \\$ text."""
    warnings: list[str] = []
    if "$$" in text and text.count("$$") % 2 != 0:
        warnings.append("\u0060$$\u0060 \u51fa\u73b0\u6b21\u6570\u4e3a\u5947\u6570\uff0c\u53ef\u80fd\u5b58\u5728\u672a\u95ed\u5408\u7684\u663e\u793a\u516c\u5f0f\u3002")
    parts = text.split("$$")
    for i in range(0, len(parts), 2):
        seg = parts[i]
        if _unescaped_dollar_count(seg) % 2 != 0:
            warnings.append("\u5728\u663e\u793a\u516c\u5f0f\u5757\u4e4b\u5916\uff0c\u5355\u4e2a \u0060$\u0060 \u672a\u6210\u5bf9\uff0c\u8bf7\u68c0\u67e5\u884c\u5185\u516c\u5f0f\u3002")
            break
    return warnings


_LATEX_SPECIAL_MESSAGES = {
    "latex_underscore": (
        "\u6b63\u6587\uff08\u975e\u6570\u5b66\u6a21\u5f0f\uff09\u4e2d\u51fa\u73b0\u672a\u8f6c\u4e49\u7684\u4e0b\u5212\u7ebf \u0060_\u0060\uff0cLaTeX \u5bfc\u51fa\u53ef\u80fd\u62a5\u9519\uff1b"
        "\u586b\u7a7a\u6a2a\u7ebf\u8bf7\u4f7f\u7528 \u0060\\\\_\u0060 \u8fde\u7eed\u4e66\u5199\u6216 \u0060\\\\underline{...}\u0060\u3002"
    ),
    "latex_caret": (
        "\u6b63\u6587\uff08\u975e\u6570\u5b66\u6a21\u5f0f\uff09\u4e2d\u51fa\u73b0\u672a\u8f6c\u4e49\u7684 \u0060^\u0060\uff0cLaTeX \u5bfc\u51fa\u53ef\u80fd\u62a5\u9519\uff1b"
        "\u8bf7\u4f7f\u7528 \u0060\\\\^{}\u0060 \u6216\u653e\u5165\u6570\u5b66\u516c\u5f0f\u4e2d\u3002"
    ),
    "latex_percent": (
        "\u6b63\u6587\uff08\u975e\u6570\u5b66\u6a21\u5f0f\uff09\u4e2d\u51fa\u73b0\u672a\u8f6c\u4e49\u7684 \u0060%\u0060\uff0cLaTeX \u4f1a\u5c06\u5176\u89c6\u4e3a\u6ce8\u91ca\u8d77\u59cb\uff1b"
        "\u8bf7\u6539\u4e3a \u0060\\\\%\u0060\u3002"
    ),
}
_LATEX_SPECIAL_CODES = {"_": "latex_underscore", "^": "latex_caret", "%": "latex_percent"}


def _scan_plain_specials(text: str) -> list[tuple[str, str]]:
    seen: set[str] = set()
    warnings: list[tuple[str, str]] = []
    for match in _PLAIN_SPECIAL_RE.finditer(text):
        char = match.group()
        code = _LATEX_SPECIAL_CODES[char]
        if code not in seen:
            warnings.append((code, _LATEX_SPECIAL_MESSAGES[code]))
            seen.add(code)
    return warnings


def _scan_math_static(text: str) -> tuple[list[tuple[str, str]], list[str]]:
    """Find LaTeX hazards and delimiter imbalance in one lexical pass."""
    has_dollar = "$" in text
    has_escape = "\\" in text
    if not has_dollar and not has_escape:
        return _scan_plain_specials(text), []
    if _PLAIN_SPECIAL_RE.search(text) is None:
        return [], _check_dollar_balance(text) if has_dollar else []

    special: list[tuple[str, str]] = []
    seen: set[str] = set()
    mode = _OUT
    special_escape_second = False
    special_pair_second = False

    display_pair_count = 0
    display_segment = False
    pair_second = False
    balance_escape_second = False
    segment_single_dollar_odd = False
    has_unbalanced_single_segment = False

    size = len(text)
    next_index = 0
    for match in _MATH_SCAN_EVENT_RE.finditer(text):
        i = match.start()
        if i > next_index:
            # Any ordinary character consumes the pending one-shot flags in
            # the original character-by-character scanner.
            special_escape_second = False
            special_pair_second = False
            pair_second = False
            balance_escape_second = False
        char = match.group()
        next_char = text[i + 1] if i + 1 < size else ""

        # Dollar-balance logic mirrors split("$$") and counts raw, non-overlap
        # display pairs even when one of their dollars is escaped in the other scan.
        is_pair_second = pair_second
        pair_second = False
        is_pair_start = not is_pair_second and char == "$" and next_char == "$"
        if is_pair_start:
            display_pair_count += 1
            if not display_segment and segment_single_dollar_odd:
                has_unbalanced_single_segment = True
            segment_single_dollar_odd = False
            display_segment = not display_segment
            pair_second = True

        was_escaped_for_balance = balance_escape_second
        balance_escape_second = False
        if not is_pair_start and not is_pair_second:
            if was_escaped_for_balance:
                pass
            elif char == "\\" and next_char:
                balance_escape_second = True
            elif char == "$" and not display_segment:
                segment_single_dollar_odd = not segment_single_dollar_odd

        # Delimiter state for the LaTeX-character scan intentionally follows the
        # historical inline/display transitions, including runs such as "$$$".
        if special_pair_second:
            special_pair_second = False
        elif special_escape_second:
            special_escape_second = False
        elif char == "\\" and next_char:
            special_escape_second = True
        elif mode == _OUT:
            if char == "$":
                if next_char == "$":
                    mode = _DISP
                    special_pair_second = True
                else:
                    mode = _IN
            elif char in "_^%":
                code = _LATEX_SPECIAL_CODES[char]
                if code not in seen:
                    special.append((code, _LATEX_SPECIAL_MESSAGES[code]))
                    seen.add(code)
        elif mode == _IN:
            if char == "$":
                mode = _OUT
        elif char == "$" and next_char == "$":
            mode = _OUT
            special_pair_second = True
        next_index = i + 1

    delimiter_warnings: list[str] = []
    if display_pair_count % 2:
        delimiter_warnings.append(
            "\u0060$$\u0060 \u51fa\u73b0\u6b21\u6570\u4e3a\u5947\u6570\uff0c\u53ef\u80fd\u5b58\u5728\u672a\u95ed\u5408\u7684\u663e\u793a\u516c\u5f0f\u3002"
        )
    if not display_segment and segment_single_dollar_odd:
        has_unbalanced_single_segment = True
    if has_unbalanced_single_segment:
        delimiter_warnings.append(
            "\u5728\u663e\u793a\u516c\u5f0f\u5757\u4e4b\u5916\uff0c\u5355\u4e2a \u0060$\u0060 \u672a\u6210\u5bf9\uff0c\u8bf7\u68c0\u67e5\u884c\u5185\u516c\u5f0f\u3002"
        )
    return special, delimiter_warnings


def _cached_math_warnings(text: str) -> tuple[list[tuple[str, str]], list[str]]:
    """Return a private copy of the static scan for this exact field text."""
    if type(text) is not str:
        lint_text = _strip_fenced_code_blocks(text)
        return _scan_math_static(lint_text)

    with _MATH_SCAN_CACHE_LOCK:
        cached = _MATH_SCAN_CACHE.get(text)
        if cached is not None:
            _MATH_SCAN_CACHE.move_to_end(text)
            special, delimiter, _weight = cached
            return list(special), list(delimiter)

    lint_text = _strip_fenced_code_blocks(text)
    special, delimiter = _scan_math_static(lint_text)
    frozen_special = tuple(special)
    frozen_delimiter = tuple(delimiter)
    weight = (
        sys.getsizeof(text)
        + sys.getsizeof(frozen_special)
        + sys.getsizeof(frozen_delimiter)
        + 128
        + 32 * (len(frozen_special) + len(frozen_delimiter))
    )
    if weight <= _MATH_SCAN_CACHE_MAX_BYTES:
        global _MATH_SCAN_CACHE_BYTES
        with _MATH_SCAN_CACHE_LOCK:
            previous = _MATH_SCAN_CACHE.pop(text, None)
            if previous is not None:
                _MATH_SCAN_CACHE_BYTES -= previous[2]
            _MATH_SCAN_CACHE[text] = (frozen_special, frozen_delimiter, weight)
            _MATH_SCAN_CACHE_BYTES += weight
            while (
                len(_MATH_SCAN_CACHE) > _MATH_SCAN_CACHE_MAX_ENTRIES
                or _MATH_SCAN_CACHE_BYTES > _MATH_SCAN_CACHE_MAX_BYTES
            ):
                _old_text, _old_entry = _MATH_SCAN_CACHE.popitem(last=False)
                _MATH_SCAN_CACHE_BYTES -= _old_entry[2]
    return special, delimiter


def _check_latex_special_chars_outside_math(text: str) -> list[tuple[str, str]]:
    """Return unique unescaped LaTeX hazards found outside math mode."""
    return _scan_math_static(text)[0]


def analyze_math_static_for_record(qualified_id: str, rec: BankRecord) -> list[dict[str, str]]:
    """Return static format warnings for one question-bank record."""
    results: list[dict[str, str]] = []
    for field, text in _collect_text_fields(rec):
        special_warnings, delimiter_warnings = _cached_math_warnings(text)
        for code, msg in special_warnings:
            results.append(
                {
                    "qualified_id": qualified_id,
                    "field": field,
                    "code": code,
                    "message": msg,
                }
            )
        for msg in delimiter_warnings:
            results.append(
                {
                    "qualified_id": qualified_id,
                    "field": field,
                    "code": "math_delimiter",
                    "message": msg,
                }
            )
    return results


def analyze_math_static_for_loaded(loaded: LoadedQuestions) -> list[dict[str, str]]:
    """
    Return warning dicts for all loaded questions.

    Codes:
    - math_delimiter: `$` / `$$` delimiters look unbalanced
    - latex_underscore / latex_caret / latex_percent: unescaped TeX special
      characters appear outside math mode
    """
    results: list[dict[str, str]] = []
    for qid, rec in loaded.by_qualified.items():
        results.extend(analyze_math_static_for_record(qid, rec))
    return results
