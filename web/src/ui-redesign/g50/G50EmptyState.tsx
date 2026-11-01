import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Network, Plus } from "lucide-react";

interface G50EmptyStateProps {
  busy?: boolean;
  onCreateGraph: (displayName: string) => Promise<void>;
}

export function G50EmptyState({ busy, onCreateGraph }: G50EmptyStateProps) {
  const { t } = useTranslation("graph");
  const [firstGraphName, setFirstGraphName] = useState("");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = firstGraphName.trim();
    if (!trimmed) return;
    void onCreateGraph(trimmed);
    setFirstGraphName("");
  };

  return (
    <div className="flex h-full flex-col items-center justify-center p-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--or-block)] text-[var(--or-muted)] shadow-sm  ">
        <Network className="h-8 w-8" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-[var(--or-text)] ">
        {t("noGraphsHint")}
      </h3>
      <p className="mt-1.5 max-w-sm text-sm text-[var(--or-muted)] ">
        {t("createFirstGraph")}
      </p>

      <form
        className="mt-6 flex w-full max-w-sm items-center gap-2"
        onSubmit={handleSubmit}
      >
        <input
          aria-label={t("newGraphNamePh")}
          className="or-g50-input flex-1"
          placeholder={t("newGraphNamePh")}
          value={firstGraphName}
          onChange={(event) => setFirstGraphName(event.target.value)}
        />
        <button
          type="submit"
          disabled={busy || !firstGraphName.trim()}
          className="or-g50-btn or-g50-btn-primary"
        >
          <Plus className="h-4 w-4" />
          <span>{t("create")}</span>
        </button>
      </form>
    </div>
  );
}
