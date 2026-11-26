import { afterEach, expect, it, vi } from "vitest";
import { readPageSelection, readVisibleText } from "../agent-chat/pageSelection";

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

function renderPage(markup: string) {
  const page = document.createElement("main");
  page.innerHTML = markup;
  document.body.appendChild(page);
  const originalRange = document.createRange.bind(document);
  vi.spyOn(document, "createRange").mockImplementation(() => {
    const range = originalRange();
    return Object.defineProperty(range, "getClientRects", {
      value: () => [range.startContainer.parentElement?.closest("[data-offscreen]")
        ? new DOMRect(10, 5000, 200, 20) : new DOMRect(10, 10, 200, 20)],
    });
  });
  return page;
}

it("captures regular controls plus currently visible page text without form or hidden data", () => {
  const page = renderPage(`<h2>试卷进度</h2><div><button><span>发布</span></button></div>
    <label>备注 <input value="secret input"></label><textarea>secret editor</textarea>
    <div contenteditable>secret edit</div><div aria-hidden="true">secret hidden</div>
    <div style="visibility:hidden">secret hidden style</div><div data-agent-private>secret private</div>
    <div data-offscreen>离开当前视口</div><div class="or-g55-agent-panel">secret AI chat</div>`);
  const result = readPageSelection(page.querySelector("button span"), "compose")!;
  expect(result.context).toMatchObject({
    current_page: "compose", selected_control: { tag: "button", label: "发布", text: "发布" },
    visible_page_text: "试卷进度\n发布\n备注",
  });
  expect(readPageSelection(page.querySelector("input"))?.context.selected_control?.text).toBe("");
  expect(readPageSelection(page.querySelector("[data-agent-private]"))).toBeNull();
  expect(readVisibleText(page, 3)).toBe("试卷进");
});

it("keeps valid marked resource IDs and supports visible unmarked text and image controls", () => {
  const page = renderPage(`<section data-agent-target="bank-question" data-agent-resource-id="math/数列/q1"><p>题目</p></section>
    <img alt="分数组成图" src="/internal/image">
    <section data-agent-target="paper-detail" data-agent-resource-id="bad id"><p>普通文字</p></section>`);
  expect(readPageSelection(page.querySelector("p"))?.context.selected_resource_id).toBe("math/数列/q1");
  const image = readPageSelection(page.querySelector("img"))!;
  expect(image.context.selected_control).toMatchObject({ tag: "img", label: "分数组成图" });
  expect(JSON.stringify(image)).not.toContain("/internal/image");
  expect(readPageSelection(page.querySelector("section:last-child p"))?.context.selected_resource_id).toBeUndefined();
});
