import { beforeEach, describe, expect, it, vi } from "vitest";

import { listPlatformPapers } from "../auth";

vi.mock("../../api/client", () => ({
  resolveApiUrl: async (path: string) => path,
}));

vi.mock("../../lib/appLog", () => ({
  logApiCall: vi.fn(),
}));

describe("listPlatformPapers", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("preserves online answer progress returned for the history sidebar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            papers: [
              {
                paper_id: "p1",
                exam_id: "demo/Math",
                title: "演示线上答题",
                delivery_mode: "online",
                total_student_count: 5,
                submitted_student_count: 4,
                in_progress_student_count: 1,
                graded_student_count: 3,
                published_student_count: 3,
              },
            ],
            total: 1,
            page: 1,
            page_size: 50,
            total_pages: 1,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const result = await listPlatformPapers({ deliveryMode: "online", pageSize: 50 });

    expect(result.papers[0]).toMatchObject({
      total_student_count: 5,
      submitted_student_count: 4,
      in_progress_student_count: 1,
      graded_student_count: 3,
      published_student_count: 3,
    });
  });
});
