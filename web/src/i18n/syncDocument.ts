const TITLES: Record<string, string> = {
  zh: "源远教学平台 · 组卷",
  en: "OriginReach · Papers",
};

export function applyDocumentLocale(lng: string) {
  const isEn = lng.startsWith("en");
  document.documentElement.lang = isEn ? "en" : "zh-CN";
  document.title = isEn ? TITLES.en : TITLES.zh;
}
