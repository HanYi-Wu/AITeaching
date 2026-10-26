import { useTranslation } from "react-i18next";
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
    <div className="space-y-3">
      <p className="text-[11px] text-slate-500">{t("noteHint")}</p>
      {!noteComposerOpen ? (
        <button
          type="button"
          className="w-full rounded-md bg-slate-900 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            setNoteEditingId(null);
            setNoteDraftBody("");
            setNoteComposerOpen(true);
          }}
        >
          {t("addNote")}
        </button>
      ) : (
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2">
          {noteEditingId ? (
            <p className="text-[11px] font-medium text-slate-600">
              {t("editNoteBanner")}
            </p>
          ) : null}
          <LatexRichTextField
            textAreaRef={noteTextAreaRef}
            syncTextAreaId={`graph-node-note-${selectedNode.id}-${noteEditingId ?? "new"}`}
            minRows={4}
            value={noteDraftBody}
            onChange={setNoteDraftBody}
            busy={busy}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
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
              {t("saveNote")}
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800"
              disabled={busy}
              onClick={() => {
                setNoteComposerOpen(false);
                setNoteEditingId(null);
                setNoteDraftBody("");
              }}
            >
              {t("cancelNote")}
            </button>
          </div>
        </div>
      )}
      <ul className="space-y-2">
        {notesList.map((note) => (
          <li
            key={note.id}
            className="relative rounded-md border border-slate-200 bg-white p-2 pr-[4.25rem] text-sm"
          >
            <div className="absolute right-1 top-1 flex items-center gap-0.5">
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                title={t("editNoteTitle")}
                disabled={busy}
                onClick={() => {
                  setNoteEditingId(note.id);
                  setNoteDraftBody(note.body);
                  setNoteComposerOpen(true);
                }}
                aria-label={t("editNoteTitle")}
              >
                {t("editNote")}
              </button>
              <button
                type="button"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[14px] leading-none text-slate-500 hover:bg-slate-100 hover:text-red-600"
                title={t("removeNoteTitle")}
                disabled={busy}
                onClick={() =>
                  void persistNotes(notesList.filter((n) => n.id !== note.id))
                }
                aria-label={t("removeNoteTitle")}
              >
                ×
              </button>
            </div>
            <ContentWithPrimeBrush text={note.body} className="text-slate-900" />
          </li>
        ))}
        {notesList.length === 0 && !noteComposerOpen ? (
          <li className="text-xs text-slate-400">{t("noNotesYet")}</li>
        ) : null}
      </ul>
    </div>
  );
}
