import { useState } from "react";
import type { ReactElement } from "react";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import type { CapMap } from "../../../../../generated/types.ts";
import { Group, Section } from "../shell/ui.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { Actions, Button, Field, Note, ReadState, useAction, useRead } from "./shared.tsx";
import { Choice } from "./ai-controls.tsx";

type Scope = "space" | "floor" | "agent";
type Act = CapMap["gate.acts.list"]["out"]["acts"][number];
type Rule = CapMap["gate.rules.list"]["out"]["rules"][number];
type Agent = CapMap["agents.list"]["out"]["agents"][number];

const title = (act: Act): string => `${act.title} · ${act.risk} risk`;
export const canEditOwnerFloor = (roles: readonly string[]): boolean => roles.includes("rol_owner");
export function gateRuleDraft(act: Rule["act"], scope: Scope, agentId: string, scoped: readonly Rule[], floor: readonly Rule[], space: readonly Rule[]): Rule | null {
  const source = scoped.find((rule) => rule.act === act)
    ?? (scope === "agent" ? floor.find((rule) => rule.act === act) : undefined)
    ?? (scope !== "space" ? space.find((rule) => rule.act === act) : undefined);
  return source ? { ...source, act, scope, ...(scope === "agent" ? { agentId } : {}) } : null;
}
const ruleMatches = (rule: Rule | undefined, expected: CapMap["gate.rules.set"]["in"]): boolean => Boolean(rule)
  && rule!.act === expected.act && rule!.scope === expected.scope && rule!.agentId === expected.agentId
  && rule!.mode === expected.mode && rule!.approvers === expected.approvers && rule!.agentOkFor === expected.agentOkFor
  && rule!.afterHours === expected.afterHours && rule!.onTimeout === expected.onTimeout && rule!.escalateTo === expected.escalateTo;

export function GateRules(): ReactElement {
  const data = useConsoleData();
  const [scope, setScope] = useState<Scope>("space");
  const [agentId, setAgentId] = useState("");
  const rules = useRead<CapMap["gate.rules.list"]["out"]>("gate.rules.list", { scope, ...(scope === "agent" && agentId ? { agentId } : {}) });
  const spaceRules = useRead<CapMap["gate.rules.list"]["out"]>("gate.rules.list", { scope: "space" });
  const floorRules = useRead<CapMap["gate.rules.list"]["out"]>("gate.rules.list", { scope: "floor" });
  const acts = useRead<CapMap["gate.acts.list"]["out"]>("gate.acts.list");
  const agents = useRead<CapMap["agents.list"]["out"]>("agents.list", { section: "space", limit: 100 });
  const people = useRead<CapMap["access.principals.list"]["out"]>("access.principals.list", { kind: "person", limit: 100 });
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Rule | null>(null);
  const [preview, setPreview] = useState<CapMap["gate.rules.set"]["in"] | null>(null);
  const refresh = (): void => { rules.refresh(); spaceRules.refresh(); floorRules.refresh(); };
  const action = useAction(() => { refresh(); setDraft(null); setPreview(null); });
  if (!rules.data || !spaceRules.data || !floorRules.data || !acts.data || !agents.data || !people.data) return <ReadState error={rules.error ?? spaceRules.error ?? floorRules.error ?? acts.error ?? agents.error ?? people.error} retry={() => { refresh(); acts.refresh(); agents.refresh(); people.refresh(); }} />;
  const owner = canEditOwnerFloor(people.data.principals.find((person) => person.id === data.me.id)?.roles ?? []);
  const selectedAct = acts.data.acts.find((act) => act.key === selected);
  const current = draft ?? rules.data.rules.find((rule) => rule.act === selected);
  const choose = (act: Act): void => {
    const rule = gateRuleDraft(act.key, scope, agentId, rules.data!.rules, floorRules.data!.rules, spaceRules.data!.rules);
    setSelected(act.key);
    setDraft(rule ?? null);
    setPreview(null);
  };
  const patch = (next: Partial<Rule>): void => {
    if (!current) return;
    setDraft({ ...current, ...next });
    setPreview(null);
  };
  const review = (): void => {
    if (!current) return;
    setPreview({ act: current.act, scope, ...(scope === "agent" ? { agentId } : {}), mode: current.mode, approvers: current.approvers, ...(current.agentOkFor ? { agentOkFor: current.agentOkFor } : {}), afterHours: current.afterHours, onTimeout: current.onTimeout, escalateTo: current.escalateTo });
  };
  return <>
    <Section title="Rule scope"><Group>
      <Choice label="Rules to edit" value={scope} options={[{ key: "space", title: "Space defaults" }, { key: "floor", title: "Owner floor" }, { key: "agent", title: "One agent" }]} onChange={(value) => { setScope(value as Scope); setSelected(null); setDraft(null); setPreview(null); }} />
      {scope === "agent" ? <Choice label="Agent" value={agentId} options={agents.data.agents.map((agent: Agent) => ({ key: agent.agentId, title: agent.name }))} onChange={(value) => { setAgentId(value); setSelected(null); setDraft(null); setPreview(null); }} /> : null}
    </Group></Section>
    {scope === "agent" && !agentId ? <Note>Choose an agent to review its Gate overrides.</Note> : <Section title="Gate acts" count={acts.data.acts.length}><Group>
      {acts.data.acts.map((act) => {
        const rule = rules.data!.rules.find((item) => item.act === act.key);
        return <Row key={act.key} title={title(act)} note={rule ? `${rule.mode === "hold" ? "Approval required" : "Allowed"} · ${rule.approvers} · ${rule.afterHours}h timeout` : "Uses the stricter parent rule"} selected={selected === act.key} onPress={() => choose(act)} />;
      })}
    </Group></Section>}
    {scope === "floor" && !owner ? <Note>Only the Space owner can change the owner floor. These rules remain visible for review.</Note> : null}
    {selectedAct && current ? <Section title={selectedAct.title}><Group>
      {!rules.data.rules.some((rule) => rule.act === selectedAct.key) ? <Note>This draft inherits the stricter parent rule. Saving creates the first override at this scope.</Note> : null}
      <Choice label="Decision" value={current.mode} options={[{ key: "hold", title: "Require approval" }, { key: "allow", title: "Allow without approval" }]} onChange={(value) => patch({ mode: value as Rule["mode"] })} />
      <Choice label="Approver" value={current.approvers} options={[{ key: "asker", title: "The person asking" }, { key: "owner", title: "Space owner" }, { key: "role:admin", title: "An admin" }]} onChange={(value) => patch({ approvers: value })} />
      {!selectedAct.peopleOnly ? <Choice label="Agents may approve through" value={current.agentOkFor ?? "none"} options={[{ key: "none", title: "People only" }, { key: "low", title: "Low-risk actions" }, { key: "medium", title: "Medium-risk actions" }, { key: "high", title: "High-risk actions" }]} onChange={(value) => {
        if (value !== "none") patch({ agentOkFor: value as NonNullable<Rule["agentOkFor"]> });
        else { const next = { ...current }; delete next.agentOkFor; setDraft(next); setPreview(null); }
      }} /> : null}
      <Field label="Timeout in hours" value={String(current.afterHours)} onChange={(value) => { const hours = Number(value); if (Number.isInteger(hours) && hours > 0) patch({ afterHours: hours }); }} />
      <Choice label="At timeout" value={current.onTimeout} options={[{ key: "drop", title: "Drop the action" }, { key: "escalate", title: "Escalate" }]} onChange={(value) => patch({ onTimeout: value as Rule["onTimeout"] })} />
      {current.onTimeout === "escalate" ? <Choice label="Escalate to" value={current.escalateTo} options={[{ key: "delegate", title: "Delegate" }, { key: "role", title: "Approver role" }]} onChange={(value) => patch({ escalateTo: value as Rule["escalateTo"] })} /> : null}
      {preview ? <>
        <Note>{preview.mode === "hold" ? `${selectedAct.title} will stop for ${preview.approvers} approval and ${preview.onTimeout} after ${preview.afterHours} hours.` : `${selectedAct.title} will run without approval at this scope. Stricter parent rules still win.`}</Note>
        <Actions><Button label="Back" onPress={() => setPreview(null)} /><Button label="Apply rule" testID="gate-rule-apply" disabled={action.busy || scope === "floor" && !owner} onPress={() => void action.run("gate.rules.set", preview, async () => {
          const readback = await data.call("gate.rules.list", { scope, ...(scope === "agent" ? { agentId } : {}) }) as CapMap["gate.rules.list"]["out"];
          if (!ruleMatches(readback.rules.find((rule) => rule.act === preview.act), preview)) throw new Error("The saved Gate rule did not match the reviewed rule.");
          return "Gate rule saved";
        })} /></Actions>
      </> : <Actions><Button label="Review change" testID="gate-rule-review" disabled={action.busy || scope === "agent" && !agentId || scope === "floor" && !owner} onPress={review} /></Actions>}
    </Group></Section> : null}
    {action.note ? <Note>{action.note}</Note> : null}
  </>;
}
