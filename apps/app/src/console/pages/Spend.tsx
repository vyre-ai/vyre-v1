import { useState } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Group, Section } from "../shell/ui.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { Actions, Button, Field, Note, ReadState, useAction, useRead } from "./shared.tsx";
import { Choice } from "./ai-controls.tsx";
import { capsMatch, dollarInput, dollars, limitDraft, raiseAmount } from "./ai-data-values.ts";

type Scope = "space" | "person" | "agent";
type SpendAgent = CapMap["agents.list"]["out"]["agents"][number];
export function mergeSpendAgents(first: readonly SpendAgent[], second: readonly SpendAgent[]): SpendAgent[] {
  const rows = new Map(first.map((agent) => [agent.agentId, agent]));
  for (const agent of second) rows.set(agent.agentId, agent);
  return [...rows.values()];
}
type Limit = "run" | "day" | "month" | "turns" | "time";
type ProviderRow = CapMap["providers.list"]["out"]["providers"][number];
type UsageOut = CapMap["engine.usage.query"]["out"];

/** "12 turns · 48k tokens": a key on a plan has no price per turn, so it reads as use. */
export function useLine(t: UsageOut["totals"]): string {
  const tokens = t.tokensIn + t.tokensOut;
  return `${t.turns} turn${t.turns === 1 ? "" : "s"} · ${tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : tokens} tokens`;
}

/** The Space AI key this month, by person: every member's turns on it are theirs. */
function SpaceKeyUsage({ now }: { now: number }): ReactElement | null {
  const providers = useRead<CapMap["providers.list"]["out"]>("providers.list", {}, { direct: true });
  const key: ProviderRow | undefined = providers.data?.providers.find((p) => p.spaceKey === true);
  const from = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1);
  const usage = useRead<UsageOut>("engine.usage.query", { by: "person", from, ...(key ? { itemId: key.itemId } : {}) }, { direct: true, enabled: key !== undefined });
  if (!key) return null;
  return <Section title="Space AI key this month"><Group testID="space-key-usage">
    {!usage.data ? <ReadState error={usage.error} retry={usage.refresh} /> : usage.data.rows.length === 0 ? <Row title={key.name} note="Nobody has used it yet" /> : <>
      <Row title={key.name} note={useLine(usage.data.totals)} />
      {usage.data.rows.map((row) => <Row key={row.key} title={row.title} note={useLine(row.totals)} />)}
    </>}
  </Group></Section>;
}
type UsageBy = "day" | "person" | "agent" | "model";

export function Spend(): ReactElement {
  const data = useConsoleData();
  const people = useRead<CapMap["access.principals.list"]["out"]>("access.principals.list", { kind: "person" });
  const agents = useRead<CapMap["agents.list"]["out"]>("agents.list", { section: "space", limit: 100 });
  const [moreAgents, setMoreAgents] = useState<SpendAgent[]>([]);
  const [agentPage, setAgentPage] = useState<{ loaded: boolean; next?: string; busy: boolean }>({ loaded: false, busy: false });
  const [scope, setScope] = useState<Scope>("space");
  const [scopeId, setScopeId] = useState("");
  if (!people.data || !agents.data) return <ReadState error={people.error ?? agents.error} retry={() => { people.refresh(); agents.refresh(); }} />;
  const agentRows = mergeSpendAgents(agents.data.agents, moreAgents);
  const agentNext = agentPage.loaded ? agentPage.next : agents.data.next;
  const changeScope = (next: Scope): void => { setScope(next); setScopeId(next === "person" ? data.me.id : next === "agent" ? agents.data!.agents[0]?.agentId ?? "" : ""); };
  const peopleOptions = [...people.data.principals.map((person) => ({ key: person.id, title: person.name })), ...(people.data.principals.some((person) => person.id === data.me.id) ? [] : [{ key: data.me.id, title: data.me.name }])];
  return <View testID="console-ai-spend"><Section title="Limits for"><Group><Choice label="Limits for" value={scope} options={[{ key: "space", title: "This Space" }, { key: "person", title: "A person" }, { key: "agent", title: "An agent" }]} onChange={(value) => changeScope(value as Scope)} />{scope === "person" ? <Choice label="Person" value={scopeId} options={peopleOptions} onChange={setScopeId} /> : scope === "agent" ? <><Choice label="Agent" value={scopeId} options={agentRows.map((agent) => ({ key: agent.agentId, title: agent.name }))} onChange={setScopeId} />{agentNext ? <Button label={agentPage.busy ? "Loading agents…" : "Load more agents"} disabled={agentPage.busy} onPress={() => { if (agentPage.busy) return; setAgentPage((current) => ({ ...current, busy: true })); void data.call("agents.list", { section: "space", cursor: agentNext, limit: 100 }).then((out) => { const page = out as CapMap["agents.list"]["out"]; setMoreAgents((current) => mergeSpendAgents(current, page.agents)); setAgentPage({ loaded: true, ...(page.next ? { next: page.next } : {}), busy: false }); }, () => setAgentPage((current) => ({ ...current, busy: false }))); }} /> : null}</> : null}</Group></Section>{scope === "space" || scopeId ? <SpendScope key={`${scope}:${scopeId}`} scope={scope} {...(scope === "space" ? {} : { scopeId })} /> : <Note>Choose who or what to review.</Note>}{scope === "space" ? <SpaceKeyUsage now={data.clock().now} /> : null}</View>;
}

function SpendScope({ scope, scopeId }: { scope: Scope; scopeId?: string }): ReactElement {
  const data = useConsoleData();
  const input = { scope, ...(scopeId ? { scopeId } : {}) };
  const spend = useRead<CapMap["engine.spend.get"]["out"]>("engine.spend.get", input);
  const [by, setBy] = useState<UsageBy>("day");
  const usage = useRead<CapMap["engine.usage.query"]["out"]>("engine.usage.query", { by });
  const [editingCaps, setEditingCaps] = useState(false);
  const [reviewedCaps, setReviewedCaps] = useState<CapMap["engine.spend.caps.set"]["in"]["caps"] | null>(null);
  const [run, setRun] = useState("");
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [turns, setTurns] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState("");
  const [pauseReason, setPauseReason] = useState("");
  const [confirmPause, setConfirmPause] = useState(false);
  const [raiseLimit, setRaiseLimit] = useState<Limit>("day");
  const [raiseMode, setRaiseMode] = useState<"once" | "permanent">("once");
  const [raiseAmountText, setRaiseAmountText] = useState("");
  const [reviewedRaise, setReviewedRaise] = useState<CapMap["engine.spend.raise"]["in"] | null>(null);
  const refresh = (): void => { spend.refresh(); usage.refresh(); };
  const action = useAction(refresh);
  if (!spend.data || !usage.data) return <ReadState error={spend.error ?? usage.error} retry={refresh} />;
  const edit = (setter: (value: string) => void, value: string): void => { setter(value); setReviewedCaps(null); setError(""); };
  const loadCaps = (): void => { const value = spend.data!.caps; setRun(dollarInput(value.run)); setDay(dollarInput(value.dayMicros)); setMonth(dollarInput(value.monthMicros)); setTurns(value.turnsPerDay === undefined ? "" : String(value.turnsPerDay)); setTime(value.timeMinutesPerRun === undefined ? "" : String(value.timeMinutesPerRun)); setEditingCaps(true); setReviewedCaps(null); setError(""); };
  const reviewCaps = (): void => { try { setReviewedCaps(limitDraft({ run, day, month, turns, time })); setError(""); } catch (failure) { setError(failure instanceof Error ? failure.message : "Check these limits."); } };
  const raiseInput = (): CapMap["engine.spend.raise"]["in"] => { const amount = raiseAmount(raiseLimit, raiseAmountText); return { ...input, limit: raiseLimit, mode: raiseMode, ...(amount === undefined ? {} : { amountMicros: amount }) }; };
  return <>
    <Section title="Spend now"><Group><Row title="Today" note={`${dollars(spend.data.todayMicros)} · ${spend.data.turnsToday} turns`} /><Row title="This month" note={dollars(spend.data.monthMicros)} /><Row title="AI state" note={spend.data.paused ? `Paused${spend.data.pausedBy ? ` by ${data.name(spend.data.pausedBy)}` : ""}` : "Running"} /></Group></Section>
    <Section title="Limits"><Group>{editingCaps ? <><Field label="Per run ($)" value={run} onChange={(value) => edit(setRun, value)} /><Field label="Per day ($)" value={day} onChange={(value) => edit(setDay, value)} /><Field label="Per month ($)" value={month} onChange={(value) => edit(setMonth, value)} /><Field label="Turns per day" value={turns} onChange={(value) => edit(setTurns, value)} /><Field label="Minutes per run" value={time} onChange={(value) => edit(setTime, value)} />{error ? <Note>{error}</Note> : null}{reviewedCaps ? <><Note>These exact limits will replace the current limits after verified readback.</Note><Actions><Button label="Back to editing" onPress={() => setReviewedCaps(null)} /><Button label="Apply limits" disabled={action.busy} onPress={() => void action.run("engine.spend.caps.set", { ...input, caps: reviewedCaps }, async () => {
        const readback = await data.call("engine.spend.get", input) as CapMap["engine.spend.get"]["out"];
        if (!capsMatch(readback.caps, reviewedCaps)) throw new Error("The saved limits did not match the reviewed limits.");
        return "Limits updated";
      }).then((out) => { if (out) { setReviewedCaps(null); setEditingCaps(false); } })} /></Actions></> : <Actions><Button label="Review limit changes" onPress={reviewCaps} /><Button label="Cancel" onPress={() => { setEditingCaps(false); setReviewedCaps(null); setError(""); }} /></Actions>}</> : <><Row title="Per run" note={spend.data.caps.run === undefined ? "No cap" : dollars(spend.data.caps.run)} /><Row title="Per day" note={spend.data.caps.dayMicros === undefined ? "No cap" : dollars(spend.data.caps.dayMicros)} /><Row title="Per month" note={spend.data.caps.monthMicros === undefined ? "No cap" : dollars(spend.data.caps.monthMicros)} /><Row title="Turns per day" note={spend.data.caps.turnsPerDay === undefined ? "No cap" : String(spend.data.caps.turnsPerDay)} /><Row title="Minutes per run" note={spend.data.caps.timeMinutesPerRun === undefined ? "No cap" : String(spend.data.caps.timeMinutesPerRun)} /><Button label="Edit limits" onPress={loadCaps} /></>}</Group></Section>
    <Section title="Emergency control"><Group>{spend.data.paused ? <><Note>New AI work is paused across this Space.</Note><Button label="Resume all AI" disabled={action.busy} onPress={() => void action.run("engine.spend.resume_all", {}, "AI resumed")} /></> : <><Field label="Pause reason" value={pauseReason} onChange={(value) => { setPauseReason(value); setConfirmPause(false); }} /><Button label="Pause all AI…" danger onPress={() => setConfirmPause(true)} />{confirmPause ? <><Note>Every person and agent in this Space will stop starting new AI work. Reason: {pauseReason.trim() || "No reason supplied"}.</Note><Actions><Button label="Cancel" onPress={() => setConfirmPause(false)} /><Button label="Confirm pause" danger disabled={action.busy} onPress={() => void action.run("engine.spend.pause_all", pauseReason.trim() ? { reason: pauseReason.trim() } : {}, "AI paused").then((out) => { if (out) setConfirmPause(false); })} /></Actions></> : null}</>}</Group></Section>
    <Section title="Raise a limit"><Group><Choice label="Limit" value={raiseLimit} options={[{ key: "run", title: "Per run" }, { key: "day", title: "Per day" }, { key: "month", title: "Per month" }, { key: "turns", title: "Turns per day" }, { key: "time", title: "Minutes per run" }]} onChange={(value) => { setRaiseLimit(value as Limit); setReviewedRaise(null); setError(""); }} /><Choice label="Raise" value={raiseMode} options={[{ key: "once", title: "Once" }, { key: "permanent", title: "Permanently" }]} onChange={(value) => { setRaiseMode(value as "once" | "permanent"); setReviewedRaise(null); }} /><Field label={raiseLimit === "turns" ? "Additional turns (optional)" : raiseLimit === "time" ? "Additional minutes (optional)" : "Amount ($, optional)"} value={raiseAmountText} onChange={(value) => { setRaiseAmountText(value); setReviewedRaise(null); setError(""); }} />{error ? <Note>{error}</Note> : null}<Button label="Review raise…" onPress={() => { try { setReviewedRaise(raiseInput()); setError(""); } catch (failure) { setError(failure instanceof Error ? failure.message : "Check the amount."); } }} />{reviewedRaise ? <><Note>{reviewedRaise.mode === "once" ? "This reviewed increase applies to the current limit period once." : "This reviewed increase changes the cap until an admin edits it again."}</Note><Actions><Button label="Back" onPress={() => setReviewedRaise(null)} /><Button label="Confirm raise" danger disabled={action.busy} onPress={() => void action.run("engine.spend.raise", reviewedRaise, "Limit raised").then((out) => { if (out) setReviewedRaise(null); })} /></Actions></> : null}</Group></Section>
    <Section title="Usage"><Group><Choice label="Group by" value={by} options={[{ key: "day", title: "Day" }, { key: "person", title: "Person" }, { key: "agent", title: "Agent" }, { key: "model", title: "Model" }]} onChange={(value) => setBy(value as UsageBy)} /><Row title="Total" note={`${dollars(usage.data.totals.costMicros)} · ${usage.data.totals.turns} turns · ${usage.data.totals.tokensIn + usage.data.totals.tokensOut} tokens`} />{usage.data.rows.map((row) => <Row key={row.key} title={row.title} note={`${dollars(row.totals.costMicros)} · ${row.totals.turns} turns`} />)}</Group></Section>
    {action.note ? <Note>{action.note}</Note> : null}
  </>;
}
