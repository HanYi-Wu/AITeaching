import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pdfPreviewModuleLoaded: vi.fn(),
  pdfPreviewRendered: vi.fn(),
}));

vi.mock("../../components/PdfPreview", () => {
  mocks.pdfPreviewModuleLoaded();
  return {
    PdfPreview: ({ apiPath }: { apiPath: string }) => {
      mocks.pdfPreviewRendered(apiPath);
      return null;
    },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { PreviewPdfModal } from "./ComposeDialogs";
import { ComposePdfPreviewAside } from "./ComposePdfPreviewAside";

function asideProps(composeRightPdfPath: string | null) {
  return {
    busy: false,
    pdfVariant: "student" as const,
    onPdfVariantChange: vi.fn(),
    pdfExamId: null,
    previewPdfId: null,
    wordOpenExamId: null,
    composeRightPdfPath,
    viewPdfBusy: false,
    viewWordBusy: false,
    onDownloadPdfBundle: vi.fn(),
    onDownloadWordBundle: vi.fn(),
    onOpenPdfExternally: vi.fn(),
    onOpenWordExternally: vi.fn(),
  };
}

describe("compose PDF preview loading", () => {
  it("loads the viewer only while an aside or modal preview is present", async () => {
    const { rerender } = render(
      <>
        <ComposePdfPreviewAside {...asideProps(null)} />
        <PreviewPdfModal open={false} pdfPath="/api/preview/modal" onClose={vi.fn()} />
      </>,
    );

    expect(mocks.pdfPreviewModuleLoaded).not.toHaveBeenCalled();
    expect(mocks.pdfPreviewRendered).not.toHaveBeenCalled();

    rerender(
      <>
        <ComposePdfPreviewAside {...asideProps("/api/preview/aside")} />
        <PreviewPdfModal open={false} pdfPath="/api/preview/modal" onClose={vi.fn()} />
      </>,
    );
    await waitFor(() => expect(mocks.pdfPreviewRendered).toHaveBeenCalledWith("/api/preview/aside"));
    expect(mocks.pdfPreviewModuleLoaded).toHaveBeenCalledOnce();

    rerender(
      <>
        <ComposePdfPreviewAside {...asideProps(null)} />
        <PreviewPdfModal open={false} pdfPath="/api/preview/modal" onClose={vi.fn()} />
      </>,
    );
    expect(mocks.pdfPreviewRendered).toHaveBeenCalledTimes(1);

    rerender(
      <>
        <ComposePdfPreviewAside {...asideProps(null)} />
        <PreviewPdfModal open pdfPath="/api/preview/modal" onClose={vi.fn()} />
      </>,
    );
    await waitFor(() => expect(mocks.pdfPreviewRendered).toHaveBeenCalledWith("/api/preview/modal"));
  });
});
