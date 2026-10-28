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
type Limit = "run" | "day" | "month" | "turns" | "time";
type UsageBy = "day" | "person" | "agent" | "model";

export function Spend(): ReactElement {
  const data = useConsoleData();
  const people = useRead<CapMap["access.principals.list"]["out"]>("access.principals.list", { kind: "person" });
  const agents = useRead<CapMap["agents.list"]["out"]>("agents.list", { section: "space", limit: 100 });
  const [scope, setScope] = useState<Scope>("space");
  const [scopeId, setScopeId] = useState("");
  if (!people.data || !agents.data) return <ReadState error={people.error ?? agents.error} retry={() => { people.refresh(); agents.refresh(); }} />;
  const changeScope = (next: Scope): void => { setScope(next); setScopeId(next === "person" ? data.me.id : next === "agent" ? agents.data!.agents[0]?.agentId ?? "" : ""); };
  const peopleOptions = [...people.data.principals.map((person) => ({ key: person.id, title: person.name })), ...(people.data.principals.some((person) => person.id === data.me.id) ? [] : [{ key: data.me.id, title: data.me.name }])];
  return <View testID="console-ai-spend"><Section title="Scope"><Group><Choice label="Limits for" value={scope} options={[{ key: "space", title: "This Space" }, { key: "person", title: "A person" }, { key: "agent", title: "An agent" }]} onChange={(value) => changeScope(value as Scope)} />{scope === "person" ? <Choice label="Person" value={scopeId} options={peopleOptions} onChange={setScopeId} /> : scope === "agent" ? <Choice label="Agent" value={scopeId} options={agents.data.agents.map((agent) => ({ key: agent.agentId, title: agent.name }))} onChange={setScopeId} /> : null}</Group></Section>{scope === "space" || scopeId ? <SpendScope key={`${scope}:${scopeId}`} scope={scope} scopeId={scope === "space" ? undefined : scopeId} /> : <Note>Choose the {scope} whose limits you want to review.</Note>}</View>;
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
