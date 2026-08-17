import type { ClipboardEvent, CSSProperties, ReactNode, Ref } from "react";
import { useTranslation } from "react-i18next";

export type NotesMode = "edit" | "split" | "preview";

type Props = {
  notes: string;
  notesMode: NotesMode;
  noteRows: number;
  noteHeightRem: number;
  deferredNotes: string;
  notesPreview: ReactNode;
  notesRef: Ref<HTMLTextAreaElement>;
  notesBoxRef: Ref<HTMLDivElement>;
  onNotesMode: (mode: NotesMode) => void;
  onNotesChange: (value: string) => void;
  onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
};

export function NotesField({
  notes, notesMode, noteRows, noteHeightRem, deferredNotes, notesPreview,
  notesRef, notesBoxRef, onNotesMode, onNotesChange, onPaste,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className="te-field te-notes-field">
      <div className="te-field-head">
        <span>{t("taskEditor.notes")}</span>
        <div className="te-segmented" role="group" aria-label={t("taskEditor.notesView")}>
          {(["edit", "split", "preview"] as const).map(mode => (
            <button type="button" key={mode}
                    aria-pressed={notesMode === mode}
                    className={notesMode === mode ? "active" : ""}
                    onClick={() => onNotesMode(mode)}>
              {t(`taskEditor.notesMode.${mode}`)}
            </button>
          ))}
        </div>
      </div>
      <div className={`te-notes te-notes-mode-${notesMode}`}
           ref={notesBoxRef}
           style={{ "--te-notes-height": `${noteHeightRem}rem` } as CSSProperties}>
        {notesMode !== "preview" && (
          <textarea aria-label={t("taskEditor.notesMarkdown")}
                    ref={notesRef}
                    value={notes} rows={noteRows}
                    onChange={e => onNotesChange(e.currentTarget.value)}
                    onPaste={onPaste} />
        )}
        {notesMode !== "edit" && (
          <div className="te-notes-preview" aria-label={t("taskEditor.notesPreview")}>
            {deferredNotes.trim() ? notesPreview : (
              <p className="te-notes-empty">{t("taskEditor.notesPreviewEmpty")}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
