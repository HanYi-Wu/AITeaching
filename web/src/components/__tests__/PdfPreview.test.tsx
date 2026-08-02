import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { apiGetBlob } = vi.hoisted(() => ({ apiGetBlob: vi.fn() }));

vi.mock("../../api/client", () => ({
  apiGetBlob,
  ensureApiBase: vi.fn().mockResolvedValue(undefined),
  resolveApiUrl: vi.fn().mockResolvedValue("/raw-pdf-url"),
}));

vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: {} },
  Document: ({
    children,
    onLoadError,
  }: {
    children: React.ReactNode;
    onLoadError?: (error: Error) => void;
  }) => (
    <button type="button" data-testid="pdf-document" onClick={() => onLoadError?.(new Error("broken PDF"))}>
      {children}
    </button>
  ),
  Page: () => <div data-testid="pdf-page" />,
}));

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { PdfPreview } from "../PdfPreview";

describe("PdfPreview", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("loads protected PDFs through the authenticated blob client and revokes the object URL", async () => {
    const blob = new Blob(["pdf"], { type: "application/pdf" });
    apiGetBlob.mockResolvedValue(blob);
    const createObjectURL = vi.fn().mockReturnValue("blob:authenticated-pdf");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );

    const view = render(<PdfPreview apiPath="/api/exam/preview-pdf/abc/file?variant=student" />);

    await waitFor(() => expect(apiGetBlob).toHaveBeenCalledWith("/api/exam/preview-pdf/abc/file?variant=student"));
    expect(createObjectURL).toHaveBeenCalledWith(blob);

    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:authenticated-pdf");
  });

  it("releases the PDF blob immediately when PDF.js cannot parse it", async () => {
    apiGetBlob.mockResolvedValue(new Blob(["broken"], { type: "application/pdf" }));
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:broken-pdf"),
      revokeObjectURL,
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    render(<PdfPreview apiPath="/api/exam/preview-pdf/broken/file" />);
    await waitFor(() => expect(screen.getByTestId("pdf-document")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("pdf-document"));

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:broken-pdf");
    expect(screen.getByRole("alert")).toHaveTextContent("broken PDF");
  });
});
