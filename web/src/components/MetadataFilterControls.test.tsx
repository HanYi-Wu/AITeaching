import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MetadataFilterControls } from "./MetadataFilterControls";
import { selectOption } from "../test/selectOption";

const DIFFICULTY = "\u96be\u5ea6";
const NOVELTY = "\u521b\u65b0\u6027";
const HIGH = "\u9ad8";
const MEDIUM = "\u4e2d";
const LOW = "\u4f4e";
const ADD_CONDITION = "\u589e\u52a0\u6807\u7b7e\u6761\u4ef6";
const SELECT_FIELD = "\u9009\u62e9\u6807\u7b7e";
const ALL = "\u5168\u90e8";

describe("MetadataFilterControls", () => {
  it("renders a newly added condition immediately", async () => {
    const onChange = vi.fn();

    render(
      <MetadataFilterControls
        definitions={[
          { key: DIFFICULTY, kind: "enum", values: [HIGH, MEDIUM, LOW] },
          { key: NOVELTY, kind: "number", min: 0.1, max: 0.9 },
        ]}
        filters={{}}
        onChange={onChange}
      />,
    );

    expect(screen.queryByDisplayValue(SELECT_FIELD)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: ADD_CONDITION }));

    const fieldSelect = screen.getByRole("combobox", { name: "标签" });
    expect(fieldSelect).not.toBeNull();

    await selectOption(fieldSelect, DIFFICULTY);

    expect(onChange).toHaveBeenLastCalledWith({ [DIFFICULTY]: { kind: "enum", selected: [] } });
    expect(screen.getByRole("combobox", { name: "标签" })).toHaveTextContent(DIFFICULTY);
    const enumSelect = screen.getAllByRole("combobox")[1]!;
    expect(enumSelect).toHaveTextContent(ALL);

    await selectOption(enumSelect, HIGH);

    expect(onChange).toHaveBeenLastCalledWith({ [DIFFICULTY]: { kind: "enum", selected: [HIGH] } });
  });
});
