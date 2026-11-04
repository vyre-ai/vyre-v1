// Console > Agents > Hooks: the rules that run before or after something an agent does. A switch says whether agents may add their own (hooks.policy.get / hooks.policy.set), and the Space's list shows
// every hook an admin can change: the Space's own (hooks.list scope space) and, for each Space agent, what that agent made for itself (hooks.list scope agent). A person's private agents are never
// listed: only the Space agents, and only what hooks.list returns. Each row has Pause or Resume (hooks.pause) and Remove with a confirm (hooks.remove); Add a hook opens a sheet (hooks.set).
// "Needs you" lists the hooks that stopped something, failed or ran out of time lately (hooks.runs.list).
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { View, useWindowDimensions } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Switch } from "../../places/settings/ui.tsx";
import { EVENT_ORDER, EVENT_WORDS, KIND_ORDER, KIND_WORDS, kindWord, whatOf } from "../../places/chats/rightpane/hooks-model.ts";
import type { Hook, HookKind } from "../../places/chats/rightpane/hooks-model.ts";
import { ago } from "../shell/format.ts";
import { Empty, Group, Section } from "../shell/ui.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { WarnTile } from "./overview/Overview.tsx";
import { IconTile } from "./CiRunners.tsx";
import { Actions, Button, Field, FormSheet, Note, ReadState, Select, Stepper, useAction } from "./shared.tsx";

type Run = CapMap["hooks.runs.list"]["out"]["runs"][number];

const DAY = 86_400_000;
/** How far back "Needs you" looks. */
export const LATELY = 7 * DAY;
const BAD: ReadonlySet<string> = new Set(["blocked", "error", "timeout"]);
const OUTCOME_WORDS: Readonly<Record<string, string>> = { blocked: "Stopped something", error: "Did not run", timeout: "Took too long" };
const WHAT_LABEL: Readonly<Record<HookKind, string>> = { command: "Script to run", check: "What to check", action: "Action to run" };

/** The runs that need a person: the latest bad run of each hook, newest first, inside the last week. */
export function needsYou(runs: readonly Run[], now: number): Run[] {
  const seen = new Set<string>();
  const out: Run[] = [];
  for (const r of [...runs].sort((a, b) => b.at - a.at)) {
    if (!BAD.has(r.outcome) || now - r.at > LATELY || seen.has(r.hookId)) continue;
    seen.add(r.hookId);
    out.push(r);
  }
  return out;
}

/** Where a hook applies, in plain words. */
export function whereWords(h: Pick<Hook, "scope" | "agentId">, nameOf: (id: string) => string): string {
  if (h.scope === "space") return "Space";
  if (h.scope === "agent") return h.agentId ? `${nameOf(h.agentId)} everywhere` : "One agent";
  if (h.scope === "person") return "One person's";
  return h.scope === "chat" ? "One chat" : "One run";
}

/** What the last run did, in a word a person reads: allowed, ran, stopped one, failed, ran out of time. */
export function lastRunWords(r: Pick<Run, "outcome">, kind: string): string {
  if (r.outcome === "blocked") return "stopped one";
  if (r.outcome === "error") return "failed";
  if (r.outcome === "timeout") return "ran out of time";
  return kind === "check" ? "allowed" : "ran";
}

/** "Made by Sara Malik (admin)", "Made by Assistant (agent)". */
export function madeByWords(h: Pick<Hook, "madeBy" | "madeByKind">, nameOf: (id: string) => string): string {
  return `Made by ${nameOf(h.madeBy)}${h.madeByKind === "admin" ? " (admin)" : h.madeByKind === "agent" ? " (agent)" : ""}`;
}

interface Loaded { hooks: Hook[]; runs: Run[]; agentHooks: boolean }

/** Reads the policy, the Space's hooks, each Space agent's own hooks and the latest runs. A read that fails on its own leaves the rest standing. */
function useHooks(): { data: Loaded | undefined; error: string | undefined; refresh: () => void } {
  const { call } = useConsoleData();
  const [rev, setRev] = useState(0);
  const [data, setData] = useState<Loaded | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const soft = async <T,>(cap: string, input: Record<string, unknown>): Promise<T | undefined> => { try { return (await call(cap, input)) as T; } catch { return undefined; } };
    void (async () => {
      const space = await soft<CapMap["hooks.list"]["out"]>("hooks.list", { scope: "space" });
      if (!space) { if (alive) setError("Couldn’t load this page. Check access and try again."); return; }
      const [policy, runs, agents] = await Promise.all([
        soft<CapMap["hooks.policy.get"]["out"]>("hooks.policy.get", {}),
        soft<CapMap["hooks.runs.list"]["out"]>("hooks.runs.list", { limit: 200 }),
        soft<CapMap["agents.list"]["out"]>("agents.list", { section: "space" }),
      ]);
      const mine = await Promise.all((agents?.agents ?? []).map((a) => soft<CapMap["hooks.list"]["out"]>("hooks.list", { scope: "agent", agentId: a.agentId })));
      const byId = new Map<string, Hook>();
      for (const h of [...space.hooks, ...mine.flatMap((m) => m?.hooks ?? [])]) if (!byId.has(h.id)) byId.set(h.id, h);
      if (alive) { setError(undefined); setData({ hooks: [...byId.values()].sort((a, b) => a.createdAt - b.createdAt), runs: runs?.runs ?? [], agentHooks: policy?.agentHooks ?? space.agentHooks }); }
    })();
    return () => { alive = false; };
  }, [call, rev]);
  const refresh = useCallback(() => setRev((n) => n + 1), []);
  return { data, error, refresh };
}

export function HooksPage(): ReactElement {
  const cd = useConsoleData();
  const narrow = useWindowDimensions().width < 600;
  const read = useHooks();
  const action = useAction(read.refresh);
  const [confirm, setConfirm] = useState("");
  const [adding, setAdding] = useState(false);
  if (!read.data) return <ReadState error={read.error} retry={read.refresh} />;
  const { hooks, runs, agentHooks } = read.data;
  const now = cd.clock().now;
  const nameOf = (id: string): string => cd.name(id);
  const lastRun = (id: string): Run | undefined => runs.filter((r) => r.hookId === id).sort((a, b) => b.at - a.at)[0];
  const needs = needsYou(runs, now).map((r) => ({ run: r, hook: hooks.find((h) => h.id === r.hookId) })).filter((x): x is { run: Run; hook: Hook } => x.hook !== undefined);
  const removing = hooks.find((h) => h.id === confirm);

  return (
    <View testID="console-hooks">
      {needs.length > 0 ? (
        <Section title="Needs you" count={needs.length}>
          <Group testID="hooks-needs">
            {needs.map(({ run, hook }) => (
              <Row key={hook.id} id={`hook-need-${hook.id}`} title={hook.line} leading={<WarnTile icon="bolt" />}
                note={`${OUTCOME_WORDS[run.outcome] ?? run.outcome}${run.detail ? `: ${run.detail}` : ""} · ${ago(now, run.at)}`}
                trailing={hook.paused ? <Button label="Resume" testID={`hook-need-resume-${hook.id}`} disabled={action.busy || !hook.canChange} onPress={() => void action.run("hooks.pause", { id: hook.id, paused: false }, "Hook running again")} />
                  : <Button label="Pause" testID={`hook-need-pause-${hook.id}`} disabled={action.busy || !hook.canChange} onPress={() => void action.run("hooks.pause", { id: hook.id, paused: true }, "Hook paused")} />} />
            ))}
          </Group>
        </Section>
      ) : null}
      <Section title="Hooks">
        <Group>
          <Row id="hooks-own" title="Agents can add their own hooks" leading={<IconTile icon="agent" />}
            note={agentHooks ? "An agent can set hooks on itself, on its helpers and in a chat. Space hooks stay yours." : "Agents ask you first. Existing hooks keep running."}
            trailing={<Switch on={agentHooks} label="Agents can add their own hooks" testID="hooks-own-switch" disabled={action.busy} onChange={(next) => void action.run("hooks.policy.set", { agentHooks: next }, next ? "Agents can add their own hooks" : "Agents ask before adding a hook")} />} />
        </Group>
      </Section>
      <Section title="In this Space" count={hooks.length} right={<Button label="Add a hook" testID="hooks-add" onPress={() => setAdding(true)} />}>
        {hooks.length === 0 ? (
          <Empty testID="hooks-empty" icon="bolt">No hooks yet. Add one to run a check or a command when something happens.</Empty>
        ) : (
          <Group testID="hooks-list">
            {hooks.map((h) => {
              const last = lastRun(h.id);
              const how = h.paused ? "Paused" : last ? `Last ran ${ago(now, last.at)}, ${lastRunWords(last, h.kind)}` : "Not run lately";
              return (
                <Row key={h.id} id={`hook-${h.id}`} tall title={h.line} leading={<IconTile icon="bolt" />}
                  note={`${kindWord(h)}: ${whatOf(h)}\n${whereWords(h, nameOf)} · ${madeByWords(h, nameOf)} · ${how}`}
                  trailing={
                    <View style={narrow ? { gap: 6 } : { flexDirection: "row", gap: 8 }}>
                      <Button small={narrow} label={h.paused ? "Resume" : "Pause"} testID={`hook-pause-${h.id}`} disabled={action.busy || !h.canChange} {...(!h.canChange ? { why: "Only an admin or the one who made it can change this" } : {})}
                        onPress={() => void action.run("hooks.pause", { id: h.id, paused: !h.paused }, h.paused ? "Hook running again" : "Hook paused")} />
                      <Button small={narrow} label="Remove" testID={`hook-remove-${h.id}`} danger disabled={action.busy || !h.canChange} {...(!h.canChange ? { why: "Only an admin or the one who made it can change this" } : {})} onPress={() => setConfirm(h.id)} />
                    </View>} />
              );
            })}
          </Group>
        )}
        {removing ? (
          <>
            <Note>Remove this hook? {removing.line} It stops running at once.</Note>
            <Actions>
              <Button label="Cancel" testID="hook-remove-cancel" onPress={() => setConfirm("")} />
              <Button label="Remove" testID="hook-remove-confirm" danger disabled={action.busy} onPress={() => void action.run("hooks.remove", { id: removing.id }, "Hook removed").then((out) => { if (out) setConfirm(""); })} />
            </Actions>
          </>
        ) : null}
      </Section>
      <Note>A hook runs a script, asks a quick check, or does an action before or after something an agent does.</Note>
      {action.note ? <Note>{action.note}</Note> : null}
      {adding ? <AddHook onClose={() => setAdding(false)} onSaved={() => { setAdding(false); read.refresh(); }} /> : null}
    </View>
  );
}

/** The Add sheet: when it runs, what kind it is, what it does, which tools it watches and how long it may take. It saves a Space hook. */
function AddHook({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }): ReactElement {
  const [event, setEvent] = useState("tool.before");
  const [kind, setKind] = useState<HookKind>("check");
  const [what, setWhat] = useState("");
  const [matcher, setMatcher] = useState("");
  const [secs, setSecs] = useState(10);
  const action = useAction(() => undefined);
  const ready = what.trim() !== "";
  const save = async (): Promise<void> => {
    const text = what.trim();
    const body = kind === "command" ? { command: text } : kind === "check" ? { instruction: text } : { cap: text, input: {} };
    const out = await action.run("hooks.set", { scope: "space", event, kind, ...(matcher.trim() ? { matcher: matcher.trim() } : {}), ...body, timeoutSec: secs }, "Hook added");
    if (out) onSaved();
  };
  return (
    <FormSheet title="Add a hook" submit="Add hook" onClose={onClose} onSubmit={() => void save()} disabled={!ready || action.busy} why={ready ? undefined : "Say what it does first"} testID="hook-sheet"
      note="A script runs on the Space's server. A check asks a quick question and may stop what is about to happen. An action calls one thing Vyre can do.">
      <Select label="When" value={event} options={EVENT_ORDER.map((k) => ({ key: k, title: EVENT_WORDS[k] ?? k }))} onChange={setEvent} />
      <Select label="Kind" value={kind} options={KIND_ORDER.map((k) => ({ key: k, title: KIND_WORDS[k] }))} onChange={(v) => setKind(v as HookKind)} />
      <Field label={WHAT_LABEL[kind]} value={what} onChange={setWhat} testID="hook-what" multiline={kind === "check"} />
      <Field label="Only for (optional)" value={matcher} onChange={setMatcher} testID="hook-matcher" />
      <Stepper label="Time limit in seconds" value={secs} onChange={setSecs} min={1} max={120} />
      {action.note ? <Note>{action.note}</Note> : null}
    </FormSheet>
  );
}
