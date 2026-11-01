import { useTranslation } from "react-i18next";
import { ArrowRight, Link as LinkIcon, X } from "lucide-react";
import { cn } from "../../lib/utils";

interface G50ConnectModalProps {
  isOpen: boolean;
  sourceNodeName: string;
  targetNodeName: string;
  connectRelType: string;
  onSelectRelType: (relType: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  relKeys: readonly string[];
}

const REL_COLORS: Record<string, string> = {
  prerequisite: "var(--or-primary)",
  part_of: "var(--or-muted)",
  related: "var(--or-success)",
  causal: "var(--or-warning)",
};

export function G50ConnectModal({
  isOpen,
  sourceNodeName,
  targetNodeName,
  connectRelType,
  onSelectRelType,
  onConfirm,
  onCancel,
  busy,
  relKeys,
}: G50ConnectModalProps) {
  const { t } = useTranslation("graph");

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-[var(--or-outline)] bg-[var(--or-card)] p-5 shadow-2xl">
        <div className="flex items-center justify-between pb-3 border-b border-[var(--or-outline)]">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--or-primary-container)] text-[var(--or-primary)]">
              <LinkIcon className="h-4 w-4" />
            </div>
            <h3 className="text-base font-semibold text-[var(--or-text)]">
              {t("chooseRelationType")}
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--or-muted)] hover:bg-[var(--or-block)] hover:text-[var(--or-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Nodes connection path display */}
        <div className="my-4 flex items-center justify-center gap-2 rounded-xl bg-[var(--or-page)] px-3 py-2.5 text-sm font-medium text-[var(--or-muted)]">
          <span className="truncate max-w-[150px]">{sourceNodeName}</span>
          <ArrowRight className="h-4 w-4 shrink-0 text-[var(--or-muted)]" />
          <span className="truncate max-w-[150px]">{targetNodeName}</span>
        </div>

        {/* Relation types grid */}
        <div className="grid grid-cols-2 gap-2.5">
          {relKeys.map((k) => {
            const isSelected = connectRelType === k;
            const accent = REL_COLORS[k] ?? "var(--or-muted)";
            return (
              <button
                key={k}
                type="button"
                onClick={() => onSelectRelType(k)}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all",
                  isSelected
                    ? "or-g50-rel-type-selected"
                    : "border-[var(--or-outline)] bg-[var(--or-card)] text-[var(--or-text)] hover:bg-[var(--or-page)]",
                )}
              >
                <span
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{ backgroundColor: accent }}
                />
                <span className="text-sm font-medium">
                  {t(`edgeKind.${k}`, { defaultValue: k })}
                </span>
              </button>
            );
          })}
        </div>

        {/* Actions */}
        <div className="mt-5 flex justify-end gap-2.5 pt-3 border-t border-[var(--or-outline)]">
          <button
            type="button"
            className="or-g50-btn or-g50-btn-secondary"
            onClick={onCancel}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            className="or-g50-btn or-g50-btn-primary"
            disabled={busy}
            onClick={onConfirm}
          >
            {t("createRelation")}
          </button>
        </div>
      </div>
    </div>
  );
}
