import { useTranslation } from "react-i18next";
import { Plus, Edit2, X, Save } from "lucide-react";
import { ContentWithPrimeBrush } from "../../components/ContentWithPrimeBrush";
import { LatexRichTextField } from "../../components/LatexRichTextField";
import type { GraphNodeNoteRow, GraphNodeRow } from "./types";

export interface NodeNotesSectionProps {
  selectedNode: GraphNodeRow;
  busy: boolean;
  notesList: GraphNodeNoteRow[];
  noteComposerOpen: boolean;
  setNoteComposerOpen: (v: boolean) => void;
  noteEditingId: string | null;
  setNoteEditingId: (v: string | null) => void;
  noteDraftBody: string;
  setNoteDraftBody: (v: string) => void;
  noteTextAreaRef: React.RefObject<HTMLTextAreaElement>;
  persistNotes: (next: GraphNodeNoteRow[]) => Promise<boolean>;
}

export function NodeNotesSection({
  selectedNode,
  busy,
  notesList,
  noteComposerOpen,
  setNoteComposerOpen,
  noteEditingId,
  setNoteEditingId,
  noteDraftBody,
  setNoteDraftBody,
  noteTextAreaRef,
  persistNotes,
}: NodeNotesSectionProps) {
  const { t } = useTranslation("graph");

  return (
    <div className="space-y-3.5">
      <p className="text-xs text-[var(--or-muted)] ">
        {t("noteHint")}
      </p>

      {!noteComposerOpen ? (
        <button
          type="button"
          className="or-g50-btn or-g50-btn-primary w-full"
          disabled={busy}
          onClick={() => {
            setNoteEditingId(null);
            setNoteDraftBody("");
            setNoteComposerOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          <span>{t("addNote")}</span>
        </button>
      ) : (
        <div className="space-y-3 rounded-2xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_80%,transparent)] p-3.5  ">
          {noteEditingId ? (
            <p className="text-xs font-semibold text-[var(--or-on-container)] ">
              {t("editNoteBanner")}
            </p>
          ) : null}

          <LatexRichTextField
            key={`graph-node-note-${selectedNode.id}-${noteEditingId ?? "new"}`}
            textAreaRef={noteTextAreaRef}
            syncTextAreaId={`graph-node-note-${selectedNode.id}-${noteEditingId ?? "new"}`}
            minRows={4}
            value={noteDraftBody}
            onChange={setNoteDraftBody}
            busy={busy}
          />

          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              className="or-g50-btn or-g50-btn-primary"
              disabled={busy}
              onClick={() =>
                void (async () => {
                  const next =
                    noteEditingId != null
                      ? notesList.map((n) =>
                          n.id === noteEditingId ? { ...n, body: noteDraftBody } : n,
                        )
                      : [...notesList, { id: crypto.randomUUID(), body: noteDraftBody }];
                  const ok = await persistNotes(next);
                  if (ok) {
                    setNoteComposerOpen(false);
                    setNoteEditingId(null);
                    setNoteDraftBody("");
                  }
                })()
              }
            >
              <Save className="h-4 w-4" />
              <span>{t("saveNote")}</span>
            </button>
            <button
              type="button"
              className="or-g50-btn or-g50-btn-secondary"
              disabled={busy}
              onClick={() => {
                setNoteComposerOpen(false);
                setNoteEditingId(null);
                setNoteDraftBody("");
              }}
            >
              <span>{t("cancelNote")}</span>
            </button>
          </div>
        </div>
      )}

      <ul className="space-y-2.5">
        {notesList.map((note) => (
          <li
            key={note.id}
            className="group relative rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] p-3 pr-20 text-sm shadow-sm   or-g50-static-card"
          >
            <div className="absolute right-2 top-2 flex items-center gap-1">
              <button
                type="button"
                className="or-g50-btn or-g50-btn-secondary !h-6 !px-2 !text-xs font-medium"
                title={t("editNoteTitle")}
                disabled={busy}
                onClick={() => {
                  setNoteEditingId(note.id);
                  setNoteDraftBody(note.body);
                  setNoteComposerOpen(true);
                }}
                aria-label={t("editNoteTitle")}
              >
                <Edit2 className="h-3 w-3 mr-1" />
                <span>{t("editNote")}</span>
              </button>
              <button
                type="button"
                className="flex h-6 w-6 items-center justify-center rounded-lg text-[var(--or-muted)] hover:bg-[var(--or-error-container)] hover:text-[var(--or-on-error)] dark:hover:bg-red-950/40"
                title={t("removeNoteTitle")}
                disabled={busy}
                onClick={() =>
                  void persistNotes(notesList.filter((n) => n.id !== note.id))
                }
                aria-label={t("removeNoteTitle")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="text-[var(--or-text)] ">
              <ContentWithPrimeBrush text={note.body} className="text-[var(--or-text)] " />
            </div>
          </li>
        ))}
        {notesList.length === 0 && !noteComposerOpen ? (
          <li className="py-4 text-center text-sm text-[var(--or-muted)] ">
            {t("noNotesYet")}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
