import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { api, Decision, Task, TaskDiff, isDone } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { BulkIntent, bulkAction, nextConflictPath } from "../state/conflictDecisions";

export function ConflictsView() {
  const { t } = useTranslation();
  const { filename } = useParams<{ filename: string }>();
  const path = filename ? decodeURIComponent(filename) : "";
  const navigate = useNavigate();

  const [diffs, setDiffs] = useState<TaskDiff[] | null>(null);
  const [chosen, setChosen] = useState<Record<string, Decision["action"]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!path) return;
    // Reset per-conflict state so navigating to the next conflict starts clean.
    setChosen({});
    setError(null);
    setDiffs(null);
    api.readConflict(path)
      .then(setDiffs)
      .catch(err => setError(errorMessage(err)));
  }, [path]);

  if (!path) return <p className="view-empty">{t("conflicts.noSelected")}</p>;
  if (error) return <p className="composer-error">{error}</p>;
  if (!diffs) return <p className="view-empty">{t("conflicts.loading")}</p>;

  const decide = (id: string, action: Decision["action"]) => {
    setChosen(s => ({ ...s, [id]: action }));
  };

  const undecided  = diffs.filter(d => chosen[d.id] === undefined).length;
  const allDecided = undecided === 0;
  const fileLabel  = path.split(/[\\/]/).pop() ?? path;

  // After resolving/dismissing, go to the next outstanding conflict (if any).
  const goNext = async () => {
    let remaining: string[] = [];
    try { remaining = await api.listConflicts(); } catch { /* fall back to Today */ }
    const next = nextConflictPath(remaining, path);
    navigate(next ? `/conflicts/${encodeURIComponent(next)}` : "/today");
  };

  const submit = async () => {
    setBusy(true);
    try {
      const decisions: Decision[] = Object.entries(chosen).map(([id, action]) =>
        ({ action, id }) as Decision
      );
      await api.resolveConflict(path, decisions);
      await goNext();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    if (!window.confirm(t("conflicts.dismissConfirm"))) return;
    try { await api.dismissConflict(path); await goNext(); }
    catch (err) { setError(errorMessage(err)); }
  };

  // Translate a bulk intent into a valid action per row kind so one-sided rows
  // are never assigned an action they don't offer (#31).
  const applyToAll = (intent: BulkIntent) => {
    const all: Record<string, Decision["action"]> = {};
    for (const d of diffs) all[d.id] = bulkAction(d, intent);
    setChosen(all);
  };

  return (
    <section>
      <header className="view-header">
        <h1>{t("conflicts.title")}</h1>
        <p className="view-sub">{fileLabel}</p>
      </header>

      <div className="conflict-bulk">
        <button onClick={() => applyToAll("mine")}   className="link-button">{t("conflicts.useAllMine")}</button>
        <button onClick={() => applyToAll("theirs")} className="link-button">{t("conflicts.useAllTheirs")}</button>
      </div>

      {diffs.length === 0
        ? <p className="view-empty">{t("conflicts.noDiffs")}</p>
        : diffs.map(d => (
          <ConflictRow
            key={d.id}
            diff={d}
            chosen={chosen[d.id]}
            onChoose={action => decide(d.id, action)}
            t={t}
          />
        ))
      }

      {/* Apply stays disabled until every row is decided. Without this hint the
          greyed-out button reads as "broken" — especially on a phone, where the
          undecided row can be scrolled far away from the button (#conflict-ux). */}
      {!allDecided && (
        <p className="conflict-remaining" role="status">
          {t("conflicts.remaining", { count: undecided })}
        </p>
      )}
      <div className="conflict-actions">
        <button onClick={dismiss} className="link-button danger">{t("conflicts.discard")}</button>
        <button onClick={submit} disabled={!allDecided || busy}>
          {busy ? t("conflicts.applying") : t("conflicts.apply")}
        </button>
      </div>
    </section>
  );
}

function ConflictRow(props: {
  diff: TaskDiff;
  chosen: Decision["action"] | undefined;
  onChoose: (action: Decision["action"]) => void;
  t: TFunction;
}) {
  const { diff, chosen, onChoose, t } = props;

  if (diff.kind === "differs") {
    return (
      <div className="conflict-row">
        <div className="conflict-row-title">"{diff.mine.title}"</div>
        <div className="conflict-row-side">
          <div className="conflict-side-label">{t("conflicts.yours")}</div>
          <TaskSummary task={diff.mine} t={t} />
        </div>
        <div className="conflict-row-side">
          <div className="conflict-side-label">{t("conflicts.theirs")}</div>
          <TaskSummary task={diff.theirs} t={t} />
        </div>
        <div className="conflict-row-actions">
          <Pick label={t("conflicts.keepMine")}   active={chosen === "keep_mine"}   onClick={() => onChoose("keep_mine")} />
          <Pick label={t("conflicts.keepTheirs")} active={chosen === "keep_theirs"} onClick={() => onChoose("keep_theirs")} />
          <Pick label={t("conflicts.keepBoth")}   active={chosen === "keep_both"}   onClick={() => onChoose("keep_both")} />
        </div>
      </div>
    );
  }
  if (diff.kind === "only_mine") {
    return (
      <div className="conflict-row">
        <div className="conflict-row-title">"{diff.mine.title}" <span className="conflict-tag">{t("conflicts.onlyYours")}</span></div>
        <TaskSummary task={diff.mine} t={t} />
        <div className="conflict-row-actions">
          <Pick label={t("conflicts.keep")} active={chosen === "keep_mine"} onClick={() => onChoose("keep_mine")} />
          <Pick label={t("conflicts.drop")} active={chosen === "drop"}      onClick={() => onChoose("drop")} />
        </div>
      </div>
    );
  }
  return (
    <div className="conflict-row">
      <div className="conflict-row-title">"{diff.theirs.title}" <span className="conflict-tag">{t("conflicts.onlyTheirs")}</span></div>
      <TaskSummary task={diff.theirs} t={t} />
      <div className="conflict-row-actions">
        <Pick label={t("conflicts.addToMine")} active={chosen === "keep_theirs"} onClick={() => onChoose("keep_theirs")} />
        <Pick label={t("conflicts.ignore")}    active={chosen === "drop"}        onClick={() => onChoose("drop")} />
      </div>
    </div>
  );
}

function TaskSummary({ task, t }: { task: Task; t: TFunction }) {
  return (
    <div className="conflict-summary">
      {isDone(task) && <span>{t("conflicts.done")}</span>}
      {task.start_date && <span>{t("conflicts.start", { date: task.start_date })}</span>}
      {task.due_date       && <span>{t("conflicts.due", { date: task.due_date })}</span>}
      {task.notes && <span className="conflict-notes">"{task.notes.slice(0, 80)}{task.notes.length > 80 ? "…" : ""}"</span>}
    </div>
  );
}

function Pick(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`conflict-pick ${props.active ? "active" : ""}`}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}
