import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlatformShell } from "../PlatformShell";

describe("PlatformShell layout", () => {
  it("fills the available app width instead of sizing to its sidebar content", () => {
    const { container } = render(
      <div className="flex h-screen">
        <PlatformShell roleLabel="管理员" title="平台管理">
          <div>右侧内容区域</div>
        </PlatformShell>
      </div>,
    );

    const shell = container.firstElementChild?.firstElementChild;
    expect(shell).toHaveClass("flex-1", "min-w-0", "w-full");

    const contentPane = screen.getByText("右侧内容区域").closest("main")?.parentElement;
    expect(contentPane).toHaveClass("flex-1", "min-w-0", "w-full");
  });
});
