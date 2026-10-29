// Place views that are not the builder. Each one is a real call or a plain empty state that says what to do next. No invented rows.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { useAutomationsData } from "../canvas/data.tsx";
import { TextButton } from "../canvas/parts.tsx";
import { ALL_RUNS_LINE, ALL_RUNS_SEARCH, EMPTY_NEEDS_NEXT, NEEDS_LINE } from "../chrome.ts";
import { choiceStartsRuns, readChoiceResult, scheduleRequestFromTask } from "./recovery.ts";
import type { ScheduleChoiceKey } from "./recovery.ts";
import { countBy } from "./read.ts";
import { filterLabel, filterMenu } from "./menus.ts";
import { Empty, Frame, MenuButton, Row, Status, useCall, useRowMenu, v } from "./parts.tsx";

export { SpaceAnalytics, AnalyticsPanel } from "./AnalyticsView.tsx";
export { Dependencies } from "./DependenciesView.tsx";
export { LiveEvents } from "./EventsView.tsx";
export { Packages } from "./PackagesView.tsx";
export { TemplateGallery } from "./TemplateGallery.tsx";

interface NeedsRow { id: string; title: string; reason: string; task: unknown }

function ScheduleChoices({ task }: { task: unknown }): ReactElement | null {
  const request = scheduleRequestFromTask(task);
  const data = useAutomationsData();
  const [count, setCount] = useState("1");
  const [cap, setCap] = useState("");
  const [pending, setPending] = useState<ScheduleChoiceKey | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!request) return null;
  async function send(key: ScheduleChoiceKey): Promise<void> {
    if (busy) return;
    const body: { automationId: string; choice: ScheduleChoiceKey; n?: number; limits?: { cap: number } } = { automationId: request!.automationId, choice: key };
    if (choiceStartsRuns(key)) {
      const n = Number.parseInt(count, 10);
      if (!Number.isInteger(n) || n < 1 || n > 500) { setNote("Enter how many, from 1 to 500."); return; }
      body.n = n;
      if (pending !== key) { setPending(key); setNote("This starts live runs for the ticks you chose. Completed work is not repeated."); return; }
    }
    if (key === "change_limits") {
      const next = Number.parseInt(cap, 10);
      if (!Number.isInteger(next) || next < 1 || next > 500) { setNote("Enter a cap from 1 to 500."); return; }
      body.limits = { cap: next };
    }
    setBusy(true);
    setPending(null);
    try {
      const result = readChoiceResult(await data.call("automations.schedule_choose", body));
      if (!result) setNote("The schedule did not answer.");
      else if (!result.ok) setNote(result.error ?? "That choice was not applied.");
      else if (result.started > 0) setNote(`Started ${result.started} runs.`);
      else if (result.paused) setNote("This schedule stays paused.");
      else setNote("The backlog was skipped and the schedule is on.");
    } catch (e: unknown) {
      setNote(e instanceof Error ? e.message : "That choice was not applied.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={v.stack} testID="schedule-recovery">
      {choiceStartsRuns(request.choices[0]?.key ?? "") || request.choices.some((choice) => choiceStartsRuns(choice.key)) ? (
        <TextInput value={count} onChangeText={setCount} keyboardType="number-pad" accessibilityLabel="How many missed runs" testID="schedule-count" style={v.input} />
      ) : null}
      {request.choices.some((choice) => choice.key === "change_limits") ? (
        <TextInput value={cap} onChangeText={setCap} keyboardType="number-pad" placeholder="Cap" accessibilityLabel="Backfill cap" testID="schedule-cap" style={v.input} />
      ) : null}
      <View style={v.choices}>
        {/* ui-rows-lint: not a list (schedule choice buttons) */}
        {request.choices.map((choice) => (
          <Pressable key={choice.key} accessibilityRole="button" disabled={busy} testID={`schedule-${choice.key}`} onPress={() => void send(choice.key)} style={v.choice}>
            <Text style={v.row}>{pending === choice.key ? "Confirm live runs" : choice.label}</Text>
          </Pressable>
        ))}
      </View>
      {note ? <Text style={v.dim}>{note}</Text> : null}
    </View>
  );
}

export function NeedsYou(): ReactElement {
  const state = useCall("tasks.needs_you", {}, (out) => {
    if (!out || typeof out !== "object" || !Array.isArray((out as { items?: unknown }).items)) return null;
    const items: NeedsRow[] = [];
    for (const row of (out as { items: unknown[] }).items) {
      if (!row || typeof row !== "object") continue;
      const rec = row as { task?: { id?: unknown; title?: unknown }; reason?: unknown };
      if (!rec.task || typeof rec.task.id !== "string" || typeof rec.task.title !== "string" || typeof rec.reason !== "string") continue;
      items.push({ id: rec.task.id, title: rec.task.title, reason: rec.reason, task: rec.task });
    }
    return items;
  });
  return (
    <Frame testID="needs-you" title="Needs you" line={NEEDS_LINE}>
      <Status state={state} />
      {state.phase === "ready" && state.value.length === 0 ? <Empty testID="needs-empty" title="Nothing needs you" next={EMPTY_NEEDS_NEXT} /> : null}
      {/* ui-rows-lint: not a list (each item is a title plus its own choice buttons) */}
      {state.phase === "ready" ? state.value.map((item) => (
        <View key={item.id} style={v.stack}>
          <Text style={v.row}>{`${item.title} · ${item.reason}`}</Text>
          <ScheduleChoices task={item.task} />
        </View>
      )) : null}
    </Frame>
  );
}

export interface RunLine { id: string; title: string; status: string; startedAt: number; automationId: string | null }

export function runLines(out: unknown): RunLine[] | null {
  if (!out || typeof out !== "object" || !Array.isArray((out as { runs?: unknown }).runs)) return null;
  const rows: RunLine[] = [];
  for (const row of (out as { runs: unknown[] }).runs) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { id?: unknown; status?: unknown; summary?: unknown; name?: unknown; startedAt?: unknown; subject?: { type?: unknown; id?: unknown } };
    if (typeof rec.id !== "string" || typeof rec.status !== "string") continue;
    rows.push({
      id: rec.id, status: rec.status, startedAt: typeof rec.startedAt === "number" ? rec.startedAt : 0,
      title: typeof rec.name === "string" ? rec.name : typeof rec.summary === "string" ? rec.summary : rec.id,
      automationId: rec.subject?.type === "automation" && typeof rec.subject.id === "string" ? rec.subject.id : null,
    });
  }
  return rows;
}

const ACTIVE = new Set(["queued", "running", "waiting"]);
export const statusWord = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Runs that match the search words and the chosen statuses. */
export function shownRuns(rows: readonly RunLine[], query: string, statuses: ReadonlySet<string>): RunLine[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((r) => (statuses.size === 0 || statuses.has(r.status)) && (needle === "" || `${r.title} ${r.status} ${r.id}`.toLowerCase().includes(needle)));
}

export function AllRuns(): ReactElement {
  const data = useAutomationsData();
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<ReadonlySet<string>>(new Set());
  const [again, setAgain] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const rm = useRowMenu();
  const state = useCall("runs.list", { scope: "all", limit: 100 }, runLines, again);
  const rows = state.phase === "ready" ? state.value : [];
  const shown = shownRuns(rows, query, statuses);
  const toggle = (s: string): void => setStatuses((cur) => { const n = new Set(cur); if (n.has(s)) n.delete(s); else n.add(s); return n; });
  const act = async (cap: "runs.stop" | "runs.retry", r: RunLine, done: string): Promise<void> => {
    try { await data.call(cap, { runId: r.id }); setNote(done); setAgain((n) => n + 1); } catch (e) { setNote(e instanceof Error ? e.message : "That did not work."); }
  };
  const rowMenu = (r: RunLine): MenuEntry[] => [
    { label: "Open the run", onSelect: () => data.nav.openRun(r.id) },
    ...(r.automationId ? [{ label: "Open the automation", onSelect: () => data.nav.openAutomation(r.automationId!) } as MenuEntry] : []),
    ...(ACTIVE.has(r.status) ? [{ separator: true } as MenuEntry, { label: "Stop this run", danger: true, onSelect: () => void act("runs.stop", r, "The run was told to stop.") } as MenuEntry] : []),
    ...(r.status === "failed" || r.status === "stopped" ? [{ separator: true } as MenuEntry, { label: "Run it again", onSelect: () => void act("runs.retry", r, "A new run started.") } as MenuEntry] : []),
  ];
  return (
    <Frame testID="all-runs" title="All runs" line={ALL_RUNS_LINE}
      actions={<><MenuButton testID="runs-status" label={filterLabel("Status", statuses, statusWord)} entries={filterMenu("All statuses", countBy(rows, (r) => r.status).map((c) => ({ value: c.value, label: statusWord(c.value), count: c.count })), statuses, toggle, () => setStatuses(new Set()))} /><TextButton label="Refresh" icon="loop" onPress={() => setAgain((n) => n + 1)} testID="runs-refresh" /></>}>
      <TextInput value={query} onChangeText={setQuery} placeholder={ALL_RUNS_SEARCH} accessibilityLabel={ALL_RUNS_SEARCH} testID="runs-search" style={v.input} />
      {rm.element}
      <Status state={state} />
      {note ? <Text style={v.dim} accessibilityLiveRegion="polite">{note}</Text> : null}
      {state.phase === "ready" && rows.length === 0 ? <Empty testID="runs-empty" title="No runs yet" next="Open an automation and choose Run, or turn one on. Its runs list here." /> : null}
      {state.phase === "ready" && rows.length > 0 && shown.length === 0 ? <Text style={v.dim}>No runs match. Clear the search or the status filter.</Text> : null}
      <View style={v.list}>
        {shown.map((r) => (
          <Row
            key={r.id} id={`run-${r.id}`} title={r.title} trailing={<Text style={r.status === "failed" ? v.tag : v.right}>{statusWord(r.status)}</Text>} onPress={() => data.nav.openRun(r.id)}
            domProps={{ "aria-label": `${r.title}, ${r.status}. Open the run`, ...rm.rowDom(r.title, () => rowMenu(r)) }}
          />
        ))}
      </View>
    </Frame>
  );
}
