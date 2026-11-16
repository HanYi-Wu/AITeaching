export type RollCallSourceMode = "range" | "custom";

export interface RollCallCandidate {
  id: string;
  label: string;
  secondary?: string;
}

export interface RollCallHistoryEntry {
  round: number;
  picked: RollCallCandidate[];
  timestamp: number;
  source: RollCallSourceMode;
}

export const DEFAULT_RANGE_START = 1;
export const DEFAULT_RANGE_END = 40;
export const MIN_RANGE_VALUE = 0;
export const MAX_RANGE_VALUE = 9999;
export const ROLL_CALL_ANIMATION_FRAMES = 12;
export const ROLL_CALL_FRAME_MS = 70;
export const ROLL_CALL_MAX_DRAW_COUNT = 10;

export function clampRangeNumber(raw: number | string, fallback: number): number {
  const parsed = typeof raw === "number" ? raw : Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const truncated = Math.trunc(parsed);
  return Math.min(MAX_RANGE_VALUE, Math.max(MIN_RANGE_VALUE, truncated));
}

export function buildRangeCandidates(start: number, end: number): RollCallCandidate[] {
  const safeStart = clampRangeNumber(start, DEFAULT_RANGE_START);
  const safeEnd = clampRangeNumber(end, DEFAULT_RANGE_END);
  const low = Math.min(safeStart, safeEnd);
  const high = Math.max(safeStart, safeEnd);
  const result: RollCallCandidate[] = [];
  for (let num = low; num <= high; num += 1) {
    result.push({
      id: `range:${num}`,
      label: String(num),
    });
  }
  return result;
}

export function parseCustomCandidates(text: string): RollCallCandidate[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  const hasExplicitDelimiter = /[\r\n,;，；\t]/.test(trimmed);
  const rawTokens = hasExplicitDelimiter
    ? trimmed.split(/[\r\n,;，；\t]+/)
    : trimmed.split(/\s+/);

  const seen = new Set<string>();
  const result: RollCallCandidate[] = [];
  for (const token of rawTokens) {
    const clean = token.trim();
    if (!clean || seen.has(clean)) {
      continue;
    }
    seen.add(clean);
    result.push({
      id: `custom:${clean}`,
      label: clean,
    });
  }
  return result;
}

export function getAvailableCandidates(
  candidates: readonly RollCallCandidate[],
  pickedIds: ReadonlySet<string>,
  noRepeat: boolean,
): RollCallCandidate[] {
  if (!noRepeat) {
    return [...candidates];
  }
  return candidates.filter((item) => !pickedIds.has(item.id));
}

export function pickUniformIndex(length: number): number {
  if (length <= 1) {
    return 0;
  }
  if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
    const maxUnbiased = Math.floor(0x100000000 / length) * length;
    const buffer = new Uint32Array(1);
    for (let attempt = 0; attempt < 16; attempt += 1) {
      window.crypto.getRandomValues(buffer);
      if (buffer[0] < maxUnbiased) {
        return buffer[0] % length;
      }
    }
    return buffer[0] % length;
  }
  return Math.floor(Math.random() * length);
}

export function pickRandomCandidates(
  available: readonly RollCallCandidate[],
  drawCount: number,
  randomIndexFn: (length: number) => number = pickUniformIndex,
): RollCallCandidate[] {
  if (available.length === 0) {
    return [];
  }
  const targetCount = Math.min(Math.max(1, Math.trunc(drawCount)), available.length);
  const copy = [...available];
  const picked: RollCallCandidate[] = [];
  for (let i = 0; i < targetCount; i += 1) {
    const idx = Math.min(copy.length - 1, Math.max(0, randomIndexFn(copy.length)));
    picked.push(copy[idx]);
    copy.splice(idx, 1);
  }
  return picked;
}
