import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { ObjectPage, ObjectSection, withBaseTabs } from "../../../../../ui/src/ObjectPage/index.tsx";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Group, Section } from "../shell/ui.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { ObjectList } from "../objects/ObjectList.tsx";
import type { ObjectListRow } from "../objects/ObjectList.tsx";
import { Actions, Button, Field, Note, ReadState, useAction, useRead } from "./shared.tsx";
import { Choice, Tick } from "./ai-controls.tsx";
import { reviewSampling } from "./ai-data-values.ts";

export function Logging(): ReactElement {
  const setting = useRead<CapMap["settings.get"]["out"]>("settings.get", { key: "engine.logging" });
  const action = useAction(setting.refresh);
  if (!setting.data) return <ReadState error={setting.error} retry={setting.refresh} />;
  const current = setting.data.row.value === "steps_and_tool_io" ? "steps_and_tool_io" : "steps";
  return <View testID="console-ai-logging"><Section title="Turn logging"><Group><Choice label="Detail kept for each turn" value={current} options={[{ key: "steps", title: "Steps only" }, { key: "steps_and_tool_io", title: "Steps and tool input/output" }]} onChange={(value) => void action.run("settings.set_space", { key: "engine.logging", value }, "Logging policy updated")} /><Row title="Steps only" note="Keeps timing, outcome and capability names without tool payloads." /><Row title="Steps and tool input/output" note="Keeps tool payloads under the Space retention and sensitivity rules." /><Button label="Reset to shipped default" disabled={action.busy || setting.data.row.source === "default"} onPress={() => void action.run("settings.reset_space", { key: "engine.logging" }, "Logging policy reset")} /></Group></Section>{action.note ? <Note>{action.note}</Note> : null}</View>;
}

type ReviewItem = CapMap["engine.review.list"]["out"]["items"][number];
export function mergeReviewPages(first: readonly ReviewItem[], second: readonly ReviewItem[]): ReviewItem[] {
  const rows = new Map(first.map((item) => [item.turnId, item]));
  for (const item of second) rows.set(item.turnId, item);
  return [...rows.values()];
}
export function ReviewSampling(): ReactElement {
  const data = useConsoleData();
  const setting = useRead<CapMap["settings.get"]["out"]>("settings.get", { key: "engine.review_sampling" });
  const [state, setState] = useState<"waiting" | "ok" | "flagged">("waiting");
  const list = useRead<CapMap["engine.review.list"]["out"]>("engine.review.list", { state, limit: 100 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [more, setMore] = useState<ReviewItem[]>([]);
  const [page, setPage] = useState<{ loaded: boolean; next?: string; busy: boolean }>({ loaded: false, busy: false });
  useEffect(() => { setMore([]); setPage({ loaded: false, busy: false }); setSelectedId(null); }, [state]);
  const refresh = (): void => { setting.refresh(); list.refresh(); };
  const action = useAction(refresh);
  if (!setting.data || !list.data) return <ReadState error={setting.error ?? list.error} retry={refresh} />;
  const configured = reviewSampling(setting.data.row.value);
  const items = mergeReviewPages(more, list.data.items);
  const selected = items.find((item) => item.turnId === selectedId) ?? null;
  if (selected) return <ReviewObject item={selected} note={action.note} busy={action.busy} onBack={() => setSelectedId(null)} onRun={action.run} />;
  const next = page.loaded ? page.next : list.data.next;
  const loadMore = (): void => {
    if (!next || page.busy) return;
    setPage((current) => ({ ...current, busy: true }));
    void data.call("engine.review.list", { state, cursor: next, limit: 100 }).then((out) => {
      const nextPage = out as CapMap["engine.review.list"]["out"];
      setMore((current) => mergeReviewPages(current, nextPage.items));
      setPage({ loaded: true, ...(nextPage.next ? { next: nextPage.next } : {}), busy: false });
    }, () => setPage((current) => ({ ...current, busy: false })));
  };
  return <ReviewList key={`${configured.percent}:${configured.labels.join(",")}`} configured={configured} items={items} state={state} setState={setState} busy={action.busy} note={action.note} onOpen={(id) => setSelectedId(id)} onRun={action.run} pagination={{ ...(next ? { next } : {}), busy: page.busy, onMore: loadMore }} />;
}

function ReviewList({ configured, items, state, setState, busy, note, onOpen, onRun, pagination }: { configured: { percent: number; labels: string[] }; items: ReviewItem[]; state: "waiting" | "ok" | "flagged"; setState(value: "waiting" | "ok" | "flagged"): void; busy: boolean; note: string; onOpen(id: string): void; onRun: <T>(cap: string, input: unknown, success: string) => Promise<T | undefined>; pagination: { next?: string; busy: boolean; onMore(): void } }): ReactElement {
  const [percent, setPercent] = useState(String(configured.percent));
  const [labels, setLabels] = useState<ReadonlySet<string>>(new Set(configured.labels));
  const [review, setReview] = useState(false);
  const rows: ObjectListRow<ReviewItem>[] = items.map((item) => ({ id: item.turnId, title: item.turnId, note: `${item.state} · ${new Date(item.sampledAt).toLocaleString()}`, search: `${item.threadId} ${item.agentId}`, filters: [item.state], value: item, actions: [{ label: "Open review", onSelect: () => onOpen(item.turnId) }] }));
  const sampling = (): { percent: number; labels: string[] } => reviewSampling({ percent: Number(percent), labels: [...labels] });
  return <View testID="console-ai-review"><Section title="Sampling policy"><Group><Field label="Percent of turns" value={percent} onChange={(value) => { setPercent(value); setReview(false); }} /><Note>Sensitivity labels</Note>{["public", "internal", "confidential", "restricted"].map((label) => <Tick key={label} label={`Sample ${label}`} checked={labels.has(label)} onChange={() => { setLabels((current) => { const next = new Set(current); if (next.has(label)) next.delete(label); else next.add(label); return next; }); setReview(false); }} />)}{review ? <><Note>{sampling().percent}% of matching turns will enter human review for {sampling().labels.join(", ") || "no labels"}.</Note><Actions><Button label="Back" onPress={() => setReview(false)} /><Button label="Apply sampling" disabled={busy} onPress={() => void onRun("settings.set_space", { key: "engine.review_sampling", value: sampling() }, "Review sampling updated").then((out) => { if (out) setReview(false); })} /></Actions></> : <Button label="Review sampling change" onPress={() => { sampling(); setReview(true); }} />}</Group></Section><Section title="Sampled turns" count={rows.length}><Choice label="State" value={state} options={[{ key: "waiting", title: "Waiting" }, { key: "ok", title: "Reviewed: fine" }, { key: "flagged", title: "Flagged" }]} onChange={(value) => setState(value as typeof state)} /><ObjectList rows={rows} selectedId={null} onOpen={(row) => onOpen(row.id)} pagination={pagination} empty="Nothing sampled in this state." /></Section>{note ? <Note>{note}</Note> : null}</View>;
}

function ReviewObject({ item, note, busy, onBack, onRun }: { item: ReviewItem; note: string; busy: boolean; onBack(): void; onRun: <T>(cap: string, input: unknown, success: string) => Promise<T | undefined> }): ReactElement {
  const names = useConsoleData();
  const turn = useRead<CapMap["engine.turn.get"]["out"]>("engine.turn.get", { turnId: item.turnId });
  const [tab, setTab] = useState("overview");
  const [reviewNote, setReviewNote] = useState("");
  const run = (id: string): Promise<boolean> | void => {
    if (id === "ok") return onRun("engine.review.mark", { turnId: item.turnId, verdict: "ok", ...(reviewNote.trim() ? { note: reviewNote.trim() } : {}) }, "Turn marked fine").then((out) => { if (out) onBack(); return out !== undefined; });
    if (id === "flag") return onRun("engine.review.mark", { turnId: item.turnId, verdict: "flagged", ...(reviewNote.trim() ? { note: reviewNote.trim() } : {}) }, "Turn flagged and incident opened").then((out) => { if (out) onBack(); return out !== undefined; });
  };
  const what = turn.data?.what;
  const body = !what ? <ReadState error={turn.error} retry={turn.refresh} /> : tab === "access" ? <ObjectSection title="Access"><Row title="Agent" note={names.name(what.turn.agentId)} /><Row title="Asker" note={names.name(what.turn.asker)} /><Row title="Machine" note={what.machine} /></ObjectSection> : tab === "activity" ? <ObjectSection title="Activity" count={what.denials.length + what.fallbacks.length}>{what.denials.map((denial, index) => <Row key={`denial-${index}`} title={`Denied ${denial.cap}`} note={denial.reason} />)}{what.fallbacks.map((fallback, index) => <Row key={`fallback-${index}`} title={fallback.kind} note={`${fallback.to} · ${new Date(fallback.at).toLocaleString()}`} />)}{what.denials.length + what.fallbacks.length === 0 ? <Note>No denials or fallbacks.</Note> : null}</ObjectSection> : tab === "steps" ? <ObjectSection title="Steps" count={what.steps.length}>{what.steps.map((step) => <Row key={step.idx} title={step.title} note={`${step.ok ? "Completed" : "Failed"} · ${step.durationMs} ms`} />)}</ObjectSection> : <ObjectSection title="Overview"><Row title="Model" note={`${what.turn.engine} · ${what.turn.model}`} /><Row title="State" note={what.turn.state} /><Row title="Usage" note={`${what.turn.tokensIn + what.turn.tokensOut} tokens`} /><Field label="Review note" value={reviewNote} onChange={setReviewNote} /></ObjectSection>;
  return <ObjectPage id={item.turnId} name={item.turnId} kind="Sampled AI turn" owner={names.name(item.agentId)} status={item.state} parent="Review sampling" onBack={onBack} actions={[{ id: "ok", label: "Mark fine", destructive: false }, { id: "flag", label: "Flag and open incident", destructive: true }]} impacts={{ flag: "Flagging this turn opens an AI incident for owner review." }} tabs={withBaseTabs([{ id: "steps", label: "Steps", count: what?.steps.length ?? null }])} activeTabId={tab} onTab={setTab} onAction={run}>{body}{note ? <Note>{note}</Note> : null}{busy ? <Note>Saving review…</Note> : null}</ObjectPage>;
}
