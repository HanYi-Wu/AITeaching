import { describe, expect, it } from "vitest";

import { applyTemplatePreset } from "./TemplateWorkspace";

describe("template presets", () => {
  it.each(['practice', 'unit', 'major'] as const)('seeds usable question sections for %s on an empty template', (preset) => {
    const draft = { template_id: 'new', layout: 'single_column' as const, latex_base: 'exam-zh-base.tex.j2', sections: [], metadata_defaults: {}, metadata_extra: {} };
    const result = applyTemplatePreset(draft, preset);
    expect(result.sections.some(section => section.required_count > 0)).toBe(true);
    expect(result.metadata_defaults).not.toHaveProperty('layout');
  });
  it("applies a major-exam layout without discarding question sections", () => {
    const draft = {
      template_id: "math",
      layout: "single_column" as const,
      latex_base: "exam-zh-base.tex.j2",
      sections: [{ section_id: "选择题", type: "single_choice", required_count: 10, score_per_item: 5 }],
      metadata_defaults: {},
      metadata_extra: { watermark: "学校" },
    };
    const result = applyTemplatePreset(draft, "major");
    expect(result.layout).toBe("double_column");
    expect(result.metadata_defaults.show_binding_line).toBe(true);
    expect(result.sections).toEqual(draft.sections);
    expect(result.metadata_extra).toEqual(draft.metadata_extra);
  });
});
