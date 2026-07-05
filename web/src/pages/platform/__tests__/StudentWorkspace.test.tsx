import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { StudentWorkspace } from "../StudentWorkspace";

const mocks = vi.hoisted(() => ({
  updateStudentAccount: vi.fn(),
}));

vi.mock("../../../platform/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../platform/auth")>();
  return {
    ...actual,
    updateStudentAccount: mocks.updateStudentAccount,
  };
});

describe("StudentWorkspace", () => {
  it("lets a student change the generated username and password", async () => {
    mocks.updateStudentAccount.mockResolvedValue({
      user: { id: "s1", role: "student", username: "student_custom", display_name: "Student", status: "active" },
    });

    render(
      <StudentWorkspace
        user={{ id: "s1", role: "student", username: "stu_abcd", display_name: "Student", status: "active" }}
        onLogout={vi.fn()}
      />,
    );

    await userEvent.type(screen.getByTestId("student-account-username"), "student_custom");
    await userEvent.type(screen.getByTestId("student-account-current-password"), "initial123");
    await userEvent.type(screen.getByTestId("student-account-new-password"), "changed123");
    await userEvent.click(screen.getByTestId("student-account-save"));

    await waitFor(() =>
      expect(mocks.updateStudentAccount).toHaveBeenCalledWith({
        username: "student_custom",
        current_password: "initial123",
        new_password: "changed123",
      }),
    );
  });
});
