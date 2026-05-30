import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, Decision, Task, TaskDiff } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { BulkIntent, bulkAction, nextConflictPath } from "../state/conflictDecisions";

export function ConflictsView() {
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

  if (!path) return <p className="view-empty">No conflict selected.</p>;
  if (error) return <p className="composer-error">{error}</p>;
  if (!diffs) return <p className="view-empty">Loading conflict…</p>;

  const decide = (id: string, action: Decision["action"]) => {
    setChosen(s => ({ ...s, [id]: action }));
  };

  const allDecided = diffs.every(d => chosen[d.id] !== undefined);
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
    if (!window.confirm("Discard this conflict file without merging?")) return;
    try { await api.dismissConflict(path); await goNext(); }
    catch (err) { setError(errorMessage(err)); }
  };

  // Translate a bulk intent into a valid action per row kind so one-sided rows
  // are never assigned an action they don't offer (#31).
  const useAll = (intent: BulkIntent) => {
    const all: Record<string, Decision["action"]> = {};
    for (const d of diffs) all[d.id] = bulkAction(d, intent);
    setChosen(all);
  };

  return (
    <section>
      <header className="view-header">
        <h1>Sync conflict</h1>
        <p className="view-sub">{fileLabel}</p>
      </header>

      <div className="conflict-bulk">
        <button onClick={() => useAll("mine")}   className="link-button">Use all mine</button>
        <button onClick={() => useAll("theirs")} className="link-button">Use all theirs</button>
      </div>

      {diffs.length === 0
        ? <p className="view-empty">No task differences. (Tag differences are ignored in v1.)</p>
        : diffs.map(d => (
          <ConflictRow
            key={d.id}
            diff={d}
            chosen={chosen[d.id]}
            onChoose={action => decide(d.id, action)}
          />
        ))
      }

      <div className="conflict-actions">
        <button onClick={dismiss} className="link-button danger">Discard conflict file</button>
        <button onClick={submit} disabled={!allDecided || busy}>
          {busy ? "Applying…" : "Apply"}
        </button>
      </div>
    </section>
  );
}

function ConflictRow(props: {
  diff: TaskDiff;
  chosen: Decision["action"] | undefined;
  onChoose: (action: Decision["action"]) => void;
}) {
  const { diff, chosen, onChoose } = props;

  if (diff.kind === "differs") {
    return (
      <div className="conflict-row">
        <div className="conflict-row-title">"{diff.mine.title}"</div>
        <div className="conflict-row-side">
          <div className="conflict-side-label">Yours</div>
          <TaskSummary task={diff.mine} />
        </div>
        <div className="conflict-row-side">
          <div className="conflict-side-label">Theirs</div>
          <TaskSummary task={diff.theirs} />
        </div>
        <div className="conflict-row-actions">
          <Pick label="Keep mine"   active={chosen === "keep_mine"}   onClick={() => onChoose("keep_mine")} />
          <Pick label="Keep theirs" active={chosen === "keep_theirs"} onClick={() => onChoose("keep_theirs")} />
          <Pick label="Keep both"   active={chosen === "keep_both"}   onClick={() => onChoose("keep_both")} />
        </div>
      </div>
    );
  }
  if (diff.kind === "only_mine") {
    return (
      <div className="conflict-row">
        <div className="conflict-row-title">"{diff.mine.title}" <span className="conflict-tag">only on yours</span></div>
        <TaskSummary task={diff.mine} />
        <div className="conflict-row-actions">
          <Pick label="Keep" active={chosen === "keep_mine"} onClick={() => onChoose("keep_mine")} />
          <Pick label="Drop" active={chosen === "drop"}      onClick={() => onChoose("drop")} />
        </div>
      </div>
    );
  }
  return (
    <div className="conflict-row">
      <div className="conflict-row-title">"{diff.theirs.title}" <span className="conflict-tag">only on theirs</span></div>
      <TaskSummary task={diff.theirs} />
      <div className="conflict-row-actions">
        <Pick label="Add to mine" active={chosen === "keep_theirs"} onClick={() => onChoose("keep_theirs")} />
        <Pick label="Ignore"      active={chosen === "drop"}        onClick={() => onChoose("drop")} />
      </div>
    </div>
  );
}

function TaskSummary({ task }: { task: Task }) {
  return (
    <div className="conflict-summary">
      {task.done && <span>✓ done</span>}
      {task.scheduled_date && <span>sched {task.scheduled_date}</span>}
      {task.due_date       && <span>due {task.due_date}</span>}
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
