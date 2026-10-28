import { useState } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Group, Section } from "../shell/ui.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { Actions, Button, Field, Note, ReadState, useAction, useRead } from "./shared.tsx";
import { Choice } from "./ai-controls.tsx";
import { amountInMicros, dollarInput, dollars, limitDraft } from "./ai-data-values.ts";

type Scope = "space" | "person" | "agent";
type Limit = "run" | "day" | "month" | "turns" | "time";
type UsageBy = "day" | "person" | "agent" | "model";

export function Spend(): ReactElement {
  const { me } = useConsoleData();
  const [scope, setScope] = useState<Scope>("space");
  const [scopeId, setScopeId] = useState("");
  const changeScope = (next: Scope): void => { setScope(next); setScopeId(next === "person" ? me.id : ""); };
  return <View testID="console-ai-spend"><Section title="Scope"><Group><Choice label="Limits for" value={scope} options={[{ key: "space", title: "This Space" }, { key: "person", title: "A person" }, { key: "agent", title: "An agent" }]} onChange={(value) => changeScope(value as Scope)} />{scope !== "space" ? <Field label={scope === "person" ? "Person id" : "Agent id"} value={scopeId} onChange={setScopeId} /> : null}</Group></Section>{scope === "space" || scopeId.trim() ? <SpendScope key={`${scope}:${scopeId}`} scope={scope} scopeId={scope === "space" ? undefined : scopeId.trim()} /> : <Note>Choose the {scope} whose limits you want to review.</Note>}</View>;
}

function SpendScope({ scope, scopeId }: { scope: Scope; scopeId?: string }): ReactElement {
  const input = { scope, ...(scopeId ? { scopeId } : {}) };
  const spend = useRead<CapMap["engine.spend.get"]["out"]>("engine.spend.get", input);
  const [by, setBy] = useState<UsageBy>("day");
  const usage = useRead<CapMap["engine.usage.query"]["out"]>("engine.usage.query", { by });
  const [caps, setCaps] = useState<CapMap["engine.spend.caps.set"]["in"]["caps"] | null>(null);
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
  const [raiseAmount, setRaiseAmount] = useState("");
  const [confirmRaise, setConfirmRaise] = useState(false);
  const refresh = (): void => { spend.refresh(); usage.refresh(); };
  const action = useAction(refresh);
  if (!spend.data || !usage.data) return <ReadState error={spend.error ?? usage.error} retry={refresh} />;
  const loaded = caps !== null;
  const loadCaps = (): void => { const value = spend.data!.caps; setRun(dollarInput(value.run)); setDay(dollarInput(value.dayMicros)); setMonth(dollarInput(value.monthMicros)); setTurns(value.turnsPerDay === undefined ? "" : String(value.turnsPerDay)); setTime(value.timeMinutesPerRun === undefined ? "" : String(value.timeMinutesPerRun)); setCaps(value); setError(""); };
  const reviewCaps = (): void => { try { setCaps(limitDraft({ run, day, month, turns, time })); setError(""); } catch (failure) { setError(failure instanceof Error ? failure.message : "Check these limits."); } };
  const raiseInput = (): CapMap["engine.spend.raise"]["in"] => ({ ...input, limit: raiseLimit, mode: raiseMode, ...(raiseAmount.trim() ? { amountMicros: amountInMicros(raiseAmount) } : {}) });
  return <>
    <Section title="Spend now"><Group><Row title="Today" note={`${dollars(spend.data.todayMicros)} · ${spend.data.turnsToday} turns`} /><Row title="This month" note={dollars(spend.data.monthMicros)} /><Row title="AI state" note={spend.data.paused ? `Paused${spend.data.pausedBy ? ` by ${spend.data.pausedBy}` : ""}` : "Running"} /></Group></Section>
    <Section title="Limits"><Group>{loaded ? <><Field label="Per run ($)" value={run} onChange={setRun} /><Field label="Per day ($)" value={day} onChange={setDay} /><Field label="Per month ($)" value={month} onChange={setMonth} /><Field label="Turns per day" value={turns} onChange={setTurns} /><Field label="Minutes per run" value={time} onChange={setTime} />{error ? <Note>{error}</Note> : null}{caps !== spend.data.caps ? <Actions><Button label="Review limit changes" onPress={reviewCaps} /><Button label="Apply limits" disabled={action.busy || Boolean(error)} onPress={() => void action.run("engine.spend.caps.set", { ...input, caps }, "Limits updated").then((out) => { if (out) setCaps(null); })} /></Actions> : null}</> : <><Row title="Per run" note={spend.data.caps.run === undefined ? "No cap" : dollars(spend.data.caps.run)} /><Row title="Per day" note={spend.data.caps.dayMicros === undefined ? "No cap" : dollars(spend.data.caps.dayMicros)} /><Row title="Per month" note={spend.data.caps.monthMicros === undefined ? "No cap" : dollars(spend.data.caps.monthMicros)} /><Row title="Turns per day" note={spend.data.caps.turnsPerDay === undefined ? "No cap" : String(spend.data.caps.turnsPerDay)} /><Row title="Minutes per run" note={spend.data.caps.timeMinutesPerRun === undefined ? "No cap" : String(spend.data.caps.timeMinutesPerRun)} /><Button label="Edit limits" onPress={loadCaps} /></>}</Group></Section>
    <Section title="Emergency control"><Group>{spend.data.paused ? <><Note>New AI work is paused across this Space.</Note><Button label="Resume all AI" disabled={action.busy} onPress={() => void action.run("engine.spend.resume_all", {}, "AI resumed")} /></> : <><Field label="Pause reason" value={pauseReason} onChange={setPauseReason} /><Button label="Pause all AI…" danger onPress={() => setConfirmPause(true)} />{confirmPause ? <><Note>Every person and agent in this Space will stop starting new AI work.</Note><Actions><Button label="Cancel" onPress={() => setConfirmPause(false)} /><Button label="Confirm pause" danger disabled={action.busy} onPress={() => void action.run("engine.spend.pause_all", pauseReason.trim() ? { reason: pauseReason.trim() } : {}, "AI paused").then((out) => { if (out) setConfirmPause(false); })} /></Actions></> : null}</>}</Group></Section>
    <Section title="Raise a limit"><Group><Choice label="Limit" value={raiseLimit} options={[{ key: "run", title: "Per run" }, { key: "day", title: "Per day" }, { key: "month", title: "Per month" }, { key: "turns", title: "Turns" }, { key: "time", title: "Time" }]} onChange={(value) => setRaiseLimit(value as Limit)} /><Choice label="Raise" value={raiseMode} options={[{ key: "once", title: "Once" }, { key: "permanent", title: "Permanently" }]} onChange={(value) => setRaiseMode(value as "once" | "permanent")} /><Field label="Amount ($, optional)" value={raiseAmount} onChange={setRaiseAmount} /><Button label="Review raise…" onPress={() => { try { raiseInput(); setError(""); setConfirmRaise(true); } catch (failure) { setError(failure instanceof Error ? failure.message : "Check the amount."); } }} />{confirmRaise ? <><Note>{raiseMode === "once" ? "This approval applies to one limit event." : "This changes the cap until an admin edits it again."}</Note><Actions><Button label="Cancel" onPress={() => setConfirmRaise(false)} /><Button label="Confirm raise" danger disabled={action.busy} onPress={() => void action.run("engine.spend.raise", raiseInput(), "Limit raised").then((out) => { if (out) setConfirmRaise(false); })} /></Actions></> : null}</Group></Section>
    <Section title="Usage"><Group><Choice label="Group by" value={by} options={[{ key: "day", title: "Day" }, { key: "person", title: "Person" }, { key: "agent", title: "Agent" }, { key: "model", title: "Model" }]} onChange={(value) => setBy(value as UsageBy)} /><Row title="Total" note={`${dollars(usage.data.totals.costMicros)} · ${usage.data.totals.turns} turns · ${usage.data.totals.tokensIn + usage.data.totals.tokensOut} tokens`} />{usage.data.rows.map((row) => <Row key={row.key} title={row.title} note={`${dollars(row.totals.costMicros)} · ${row.totals.turns} turns`} />)}</Group></Section>
    {action.note ? <Note>{action.note}</Note> : null}
  </>;
}
