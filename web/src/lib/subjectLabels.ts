const SUBJECT_LABELS: Record<string, string> = {
  math: "数学",
  mathematics: "数学",
  chinese: "语文",
  english: "英语",
  physics: "物理",
  chemistry: "化学",
  biology: "生物",
  history: "历史",
  geography: "地理",
  politics: "政治",
  science: "科学",
  computer: "信息技术",
  it: "信息技术",
};

export function formatSubjectLabel(subject?: string | null, fallback = ""): string {
  const raw = (subject ?? "").trim();
  if (!raw) return fallback;
  const key = raw.toLowerCase();
  return Object.prototype.hasOwnProperty.call(SUBJECT_LABELS, key) ? SUBJECT_LABELS[key] : raw;
}
