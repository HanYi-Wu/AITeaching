import type { AriaLabelConfig } from "@xyflow/react";
import type { TFunction } from "i18next";

/**
 * Build localized accessibility and tooltip labels for React Flow canvas
 * controls and minimap across graph and mind map views.
 */
export function buildFlowAriaLabelConfig(
  t: TFunction<"graph">,
): Partial<AriaLabelConfig> {
  return {
    "controls.ariaLabel": t("canvasControlsAria"),
    "controls.zoomIn.ariaLabel": t("zoomInCanvas"),
    "controls.zoomOut.ariaLabel": t("zoomOutCanvas"),
    "controls.fitView.ariaLabel": t("fitViewCanvas"),
    "controls.interactive.ariaLabel": t("toggleInteractiveCanvas"),
    "minimap.ariaLabel": t("minimapAria"),
  };
}
