import { afterEach, describe, expect, it, vi } from "vitest";
import { readStagePalette } from "./stagePaint";

const mockComputedStyle = (properties: Record<string, string>) => {
  vi.spyOn(window, "getComputedStyle").mockImplementation(() => ({
    getPropertyValue: (name: string) => properties[name] ?? "",
  }) as CSSStyleDeclaration);
};

const readPaletteWith = (properties: Record<string, string>) => {
  mockComputedStyle(properties);
  return readStagePalette(document.createElement("div"));
};

const mainColors = (palette: ReturnType<typeof readStagePalette>) => [
  palette.user,
  palette.role,
  palette.menu,
  palette.permission,
  palette.accent,
];

describe("readStagePalette primary color", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("follows a changed hex primary color across every permission category", () => {
    const properties: Record<string, string> = { "--or-primary": "#007AFF" };
    mockComputedStyle(properties);
    const element = document.createElement("div");

    const defaultPalette = readStagePalette(element);
    expect(mainColors(defaultPalette)).toEqual([
      "0, 122, 255",
      "0, 122, 255",
      "0, 122, 255",
      "0, 122, 255",
      "0, 122, 255",
    ]);

    properties["--or-primary"] = "#CB30E0";
    const changedPalette = readStagePalette(element);
    expect(mainColors(changedPalette)).toEqual([
      "203, 48, 224",
      "203, 48, 224",
      "203, 48, 224",
      "203, 48, 224",
      "203, 48, 224",
    ]);
  });

  it("parses rgb colors and keeps the existing category colors when primary is missing", () => {
    const rgbPalette = readPaletteWith({ "--or-primary": "rgb(52, 199, 89)" });
    expect(mainColors(rgbPalette)).toEqual([
      "52, 199, 89",
      "52, 199, 89",
      "52, 199, 89",
      "52, 199, 89",
      "52, 199, 89",
    ]);

    const fallbackPalette = readPaletteWith({
      "--pe-user": "1, 2, 3",
      "--pe-role": "4, 5, 6",
      "--pe-menu": "7, 8, 9",
      "--pe-permission": "10, 11, 12",
      "--pe-accent": "13, 14, 15",
    });
    expect(mainColors(fallbackPalette)).toEqual([
      "1, 2, 3",
      "4, 5, 6",
      "7, 8, 9",
      "10, 11, 12",
      "13, 14, 15",
    ]);
  });
});
