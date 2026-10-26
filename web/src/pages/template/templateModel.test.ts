import { describe, expect, it } from "vitest";
import yaml from "js-yaml";
import {
  type Draft,
  type MetadataUiField,
  buildTemplateYaml,
  buildTemplateYamlObject,
  serializeExtraForYaml,
  addSectionItem,
  updateSectionItem,
  moveSectionItem,
  removeSectionItem,
  parseLinewidthPercent,
  linewidthPercentToLatex,
  parseTextheightPercent,
  textheightPercentToLatex,
} from "./templateModel";

describe("templateModel pure field rules and serialization", () => {
  const fieldsSpec: MetadataUiField[] = [
    {
      key: "title_block_style",
      label: "标题块样式",
      kind: "select",
      options: [
        { value: "default", label: "默认" },
        { value: "exam2024", label: "高考" },
      ],
      omit_values: ["default"],
    },
    {
      key: "school_header",
      label: "卷首抬头",
      kind: "textarea",
      omit_values: [""],
    },
    {
      key: "show_watermark",
      label: "显示水印",
      kind: "checkbox",
      omit_values: [false],
    },
    {
      key: "column_spacing",
      label: "栏间距",
      kind: "number",
      min: 0,
      max: 10,
      omit_values: [0],
    },
  ];

  describe("serializeExtraForYaml", () => {
    it("preserves unknown extension fields without dropping them", () => {
      expect(serializeExtraForYaml("custom_string", "secret-code", fieldsSpec)).toBe("secret-code");
      expect(serializeExtraForYaml("custom_number", 42, fieldsSpec)).toBe(42);
      expect(serializeExtraForYaml("custom_boolean", true, fieldsSpec)).toBe(true);
      expect(serializeExtraForYaml("custom_obj", { nested: "value" }, fieldsSpec)).toEqual({
        nested: "value",
      });
      expect(serializeExtraForYaml("custom_array", [1, 2, 3], fieldsSpec)).toEqual([1, 2, 3]);
    });

    it("omits empty strings and undefined/null for unknown fields", () => {
      expect(serializeExtraForYaml("custom_empty", "", fieldsSpec)).toBeUndefined();
      expect(serializeExtraForYaml("custom_spaces", "   ", fieldsSpec)).toBeUndefined();
      expect(serializeExtraForYaml("custom_null", null, fieldsSpec)).toBeUndefined();
      expect(serializeExtraForYaml("custom_undef", undefined, fieldsSpec)).toBeUndefined();
    });

    it("honors omit_values for select, text, checkbox, and number", () => {
      // select
      expect(serializeExtraForYaml("title_block_style", "default", fieldsSpec)).toBeUndefined();
      expect(serializeExtraForYaml("title_block_style", "exam2024", fieldsSpec)).toBe("exam2024");

      // textarea
      expect(serializeExtraForYaml("school_header", "", fieldsSpec)).toBeUndefined();
      expect(serializeExtraForYaml("school_header", "  ", fieldsSpec)).toBeUndefined();
      expect(serializeExtraForYaml("school_header", "实验中学", fieldsSpec)).toBe("实验中学");

      // checkbox
      expect(serializeExtraForYaml("show_watermark", false, fieldsSpec)).toBeUndefined();
      expect(serializeExtraForYaml("show_watermark", true, fieldsSpec)).toBe(true);

      // number
      expect(serializeExtraForYaml("column_spacing", 0, fieldsSpec)).toBeUndefined();
      expect(serializeExtraForYaml("column_spacing", 5, fieldsSpec)).toBe(5);
      expect(serializeExtraForYaml("column_spacing", "not-a-number", fieldsSpec)).toBeUndefined();
    });
  });

  describe("buildTemplateYamlObject and buildTemplateYaml", () => {
    it("preserves unknown extension fields and does not write back omitted defaults", () => {
      const draft: Draft = {
        template_id: "test_tpl",
        layout: "single_column",
        latex_base: "exam-zh-base.tex.j2",
        sections: [
          {
            section_id: "说明",
            type: "text",
            required_count: 5, // Should be normalized to 0 for text
            score_per_item: 0,
            describe: "考试须知",
          },
          {
            section_id: "单选",
            type: "single_choice",
            required_count: 10,
            score_per_item: 3,
            describe: "",
          },
        ],
        metadata_defaults: {
          margin_cm: 2.0,
          body_font_size_pt: 11,
          show_binding_line: false,
          show_name_column: true,
        },
        metadata_extra: {
          title_block_style: "default", // Should be omitted per omit_values
          school_header: "示范高中", // Should be preserved
          show_watermark: false, // Should be omitted per omit_values
          column_spacing: 0, // Should be omitted per omit_values
          unknown_custom_policy: "keep_me", // Unknown extension field must be preserved
          unknown_meta_json: { version: 2 }, // Complex unknown extension field preserved
        },
      };

      const editorDefaults = {
        margin_cm: 2.5,
        body_font_size_pt: 10.5,
        mermaid_pdf: { landscape_width: "0.62\\linewidth", portrait_width: "0.52\\linewidth", portrait_max_height: "0.40\\textheight" },
        primebrush_pdf: { latex_width: "0.90\\linewidth" },
      };

      const yamlObj = buildTemplateYamlObject(draft, {
        fields: fieldsSpec,
        editorDefaults,
      });

      const md = yamlObj.metadata_defaults as Record<string, unknown>;
      // Omitted values must not be written back
      expect(md.title_block_style).toBeUndefined();
      expect(md.show_watermark).toBeUndefined();
      expect(md.column_spacing).toBeUndefined();
      expect(md.show_binding_line).toBeUndefined();

      // Values kept
      expect(md.school_header).toBe("示范高中");
      expect(md.unknown_custom_policy).toBe("keep_me");
      expect(md.unknown_meta_json).toEqual({ version: 2 });
      expect(md.margin_cm).toBe(2.0);
      expect(md.show_name_column).toBe(true);

      // Text section required_count forced to 0
      const sections = yamlObj.sections as { type: string; required_count: number; describe?: string }[];
      expect(sections[0].type).toBe("text");
      expect(sections[0].required_count).toBe(0);
      expect(sections[0].describe).toBe("考试须知");
      expect(sections[1].required_count).toBe(10);
      expect(sections[1].describe).toBeUndefined(); // Empty describe omitted

      // Verify serialization output is valid YAML
      const yamlStr = buildTemplateYaml(draft, { fields: fieldsSpec, editorDefaults });
      const parsedBack = yaml.load(yamlStr) as typeof yamlObj;
      expect(parsedBack.template_id).toBe("test_tpl");
      expect((parsedBack.metadata_defaults as Record<string, unknown>).unknown_custom_policy).toBe("keep_me");
    });

    it("omits layout defaults when they match editorDefaults", () => {
      const draft: Draft = {
        template_id: "default_match",
        layout: "single_column",
        latex_base: "exam-zh-base.tex.j2",
        sections: [],
        metadata_defaults: {
          margin_cm: 2.5,
          mermaid_pdf: {
            landscape_width: "0.62\\linewidth",
            portrait_width: "0.52\\linewidth",
            portrait_max_height: "0.40\\textheight",
          },
          primebrush_pdf: {
            latex_width: "0.90\\linewidth",
          },
        },
        metadata_extra: {},
      };

      const editorDefaults = {
        margin_cm: 2.5,
        mermaid_pdf: {
          landscape_width: "0.62\\linewidth",
          portrait_width: "0.52\\linewidth",
          portrait_max_height: "0.40\\textheight",
        },
        primebrush_pdf: {
          latex_width: "0.90\\linewidth",
        },
      };

      const yamlObj = buildTemplateYamlObject(draft, { editorDefaults });
      const md = yamlObj.metadata_defaults as Record<string, unknown>;
      expect(md.margin_cm).toBeUndefined();
      expect(md.mermaid_pdf).toBeUndefined();
      expect(md.primebrush_pdf).toBeUndefined();
    });
  });

  describe("percent and latex conversions", () => {
    it("converts linewidth percent to latex correctly", () => {
      expect(linewidthPercentToLatex(100)).toBe("1\\linewidth");
      expect(linewidthPercentToLatex(50)).toBe("0.5\\linewidth");
      expect(linewidthPercentToLatex(62.5)).toBe("0.625\\linewidth");
      expect(parseLinewidthPercent("0.62\\linewidth", 50)).toBe(62);
      expect(parseLinewidthPercent("", 50)).toBe(50);
      expect(parseLinewidthPercent("invalid", 50)).toBe(50);
    });

    it("converts textheight percent to latex correctly", () => {
      expect(textheightPercentToLatex(40)).toBe("0.4\\textheight");
      expect(parseTextheightPercent("0.40\\textheight", 30)).toBe(40);
      expect(parseTextheightPercent(undefined, 30)).toBe(30);
    });
  });

  describe("pure section list manipulation", () => {
    const initialSections = [
      { section_id: "说明", type: "text", required_count: 0, score_per_item: 0 },
      { section_id: "单选题 1", type: "single_choice", required_count: 5, score_per_item: 2 },
      { section_id: "填空题 1", type: "fill", required_count: 4, score_per_item: 3 },
    ];

    it("adds sections with incremented ordinal and proper defaults", () => {
      const next1 = addSectionItem(initialSections, "single_choice", "单选题");
      expect(next1[next1.length - 1].section_id).toBe("单选题 2");
      expect(next1[next1.length - 1].required_count).toBe(1);
      expect(next1[next1.length - 1].score_per_item).toBe(5);

      const nextText = addSectionItem(initialSections, "text", "文字说明");
      expect(nextText[nextText.length - 1].section_id).toBe("文字说明 1");
      expect(nextText[nextText.length - 1].required_count).toBe(0);
      expect(nextText[nextText.length - 1].score_per_item).toBe(0);
    });

    it("updates section and ensures required_count is 0 for text", () => {
      const updated = updateSectionItem(initialSections, 1, { score_per_item: 4 });
      expect(updated[1].score_per_item).toBe(4);

      const toText = updateSectionItem(initialSections, 1, { type: "text", required_count: 10 });
      expect(toText[1].type).toBe("text");
      expect(toText[1].required_count).toBe(0);
    });

    it("moves section up and down preserving boundaries", () => {
      const movedUp = moveSectionItem(initialSections, 2, -1);
      expect(movedUp[1].section_id).toBe("填空题 1");
      expect(movedUp[2].section_id).toBe("单选题 1");

      const atTop = moveSectionItem(initialSections, 0, -1);
      expect(atTop).toBe(initialSections);

      const atBottom = moveSectionItem(initialSections, 2, 1);
      expect(atBottom).toBe(initialSections);
    });

    it("removes section by index", () => {
      const removed = removeSectionItem(initialSections, 1);
      expect(removed.length).toBe(2);
      expect(removed.some((s) => s.section_id === "单选题 1")).toBe(false);
    });
  });
});
