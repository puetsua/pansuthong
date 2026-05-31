import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { api, Tag } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { parseComposer } from "../state/parse";
import { resolveTagIds } from "../state/quickAdd";
import { todayIso } from "../lib/dates";
import { ComposerPreview } from "../components/ComposerPreview";

export function QuickCapture() {
  const [input, setInput] = useState("");
  const [tagsByName, setTagsByName] = useState<Map<string, Tag>>(new Map());
  const [error, setError] = useState<string | null>(null);
  // Confirmation shown after a "keep open" (Shift+Enter) save, since the only
  // other signal is the input clearing — easy to miss when capturing rapidly (#51).
  const [savedFlash, setSavedFlash] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseComposer(input, todayIso()), [input]);
  // Typed something that's only tags/dates — tell the user a title is required (#51).
  const needsTitle = input.trim().length > 0 && !parsed.title;

  // Load tags (for #tag de-dup) on mount and whenever the store changes.
  useEffect(() => {
    const loadTags = async () => {
      try {
        const doc = await api.getDocument();
        const m = new Map<string, Tag>();
        for (const t of doc.tags) m.set(t.name.toLowerCase(), t);
        setTagsByName(m);
      } catch (err) {
        setError(errorMessage(err));
      }
    };
    void loadTags();
    const unlisten = listen("store-changed", () => { void loadTags(); });
    return () => { void unlisten.then(f => f()); };
  }, []);

  // The backend emits "capture-focus" each time the hotkey re-shows the window.
  useEffect(() => {
    const focusFresh = () => {
      setInput("");
      setError(null);
      setSavedFlash(false);
      inputRef.current?.focus();
    };
    focusFresh(); // also focus on first mount
    const unlisten = listen("capture-focus", focusFresh);
    return () => { void unlisten.then(f => f()); };
  }, []);

  const save = async (closeAfter: boolean) => {
    if (!parsed.title) return;
    try {
      const tagIds = await resolveTagIds(parsed.tag_names, tagsByName, api.addTag);
      await api.addTask({
        title: parsed.title,
        due_date: parsed.due_date,
        // No today-default here (unlike the Today composer): undated tasks land in Inbox.
        scheduled_date: parsed.scheduled_date,
        tag_ids: tagIds,
      });
      setInput("");
      setError(null);
      if (closeAfter) await getCurrentWindow().hide();
      else setSavedFlash(true); // keep-open: confirm the capture took
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void save(true); // plain Enter: save and close
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setInput("");
      void getCurrentWindow().hide();
    } else if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      void save(false); // rapid-fire: save and keep the window open
    }
  };

  return (
    <form className="quick-capture" onSubmit={onSubmit}>
      <input
        ref={inputRef}
        className="quick-capture-input"
        value={input}
        onChange={e => { setInput(e.currentTarget.value); setSavedFlash(false); }}
        onKeyDown={onKeyDown}
        placeholder="Quick add…  (#tag  due fri)"
        aria-label="Quick capture"
      />
      <ComposerPreview parsed={parsed} tagsByName={tagsByName} />
      <div className="quick-capture-hint">
        Enter to save · Shift+Enter to keep open · Esc to cancel
      </div>
      {needsTitle && <p className="quick-capture-hint">Add a title — that's only tags/dates.</p>}
      {savedFlash && <p className="quick-capture-saved" role="status">Saved ✓</p>}
      {error && <p className="quick-capture-error">{error}</p>}
    </form>
  );
}
