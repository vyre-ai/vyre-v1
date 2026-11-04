// Settings > Privacy and security > Approvals: the "Always let" rules a person has made when an agent asked, one line per agent and recipient ("Dex can message Aliza Rizvi without asking"), each with Remove.
// Reads gate.allow.list, removes with gate.allow.remove. A rule that is not an Always let (a standing or a goal's own) is the Console's and is not shown here.
import { useState } from "react";
import type { ReactElement } from "react";
import type { CapMap } from "../../../../../generated/types.ts";
import { useSettingsData } from "./data.tsx";
import { useRead } from "./blocks.tsx";
import { useSaved } from "./saved.tsx";
import { Glyph, Section, SettingsRow, SmallButton } from "./ui.tsx";

type Rule = CapMap["gate.allow.list"]["out"]["rules"][number];

/** What an agent may do without asking, in the words a person says it. */
const DOES: Record<Rule["act"], string> = {
  send: "message", post: "post to", pay: "pay", delete: "delete", transfer: "transfer to", enroll_node: "add a machine for", connection_change: "change the connection to",
  push_protected: "push to", secret_export: "export a secret to", site_promote: "publish", signature_send: "send for signature to", spend_raise: "raise the spend limit of", signin_change: "change the sign-in of", approve: "approve",
};

/** "Dex can message Aliza Rizvi without asking". */
export function approvalLine(rule: Pick<Rule, "act" | "target" | "agentId">, name: (id: string) => string): string {
  const who = rule.agentId ? name(rule.agentId) : "An agent";
  return `${who} can ${DOES[rule.act]} ${name(rule.target)} without asking`;
}

/** The rules this section shows: the Always let ones, one per agent and recipient, in the order the Space keeps them. */
export const alwaysLet = (rules: readonly Rule[]): Rule[] => rules.filter((r) => r.kind === "always");

export function ApprovalsSection(): ReactElement {
  const data = useSettingsData();
  const saved = useSaved();
  const out = useRead<CapMap["gate.allow.list"]["out"]>("gate.allow.list");
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const remove = (r: Rule): void => {
    void Promise.resolve(data.call("gate.allow.remove", { id: r.id })).then(
      () => { setGone((g) => new Set([...g, r.id])); saved.saved(`Removed. ${r.agentId ? data.name(r.agentId) : "The agent"} asks again`); },
      (e: unknown) => saved.failed(e instanceof Error ? e.message : "That did not work."),
    );
  };
  if (out === null) return <Section title="Approvals" testID="approvals" />;
  const rules = alwaysLet(out.rules).filter((r) => !gone.has(r.id));
  return (
    <Section title="Approvals" testID="approvals">
      {rules.length === 0
        ? <SettingsRow id="approvals.none" label="Nothing is always allowed" first lead={<Glyph name="key" size={16} />} sub="When an agent asks, choose Always let, and the rule shows here" />
        // ui-rows-lint: not a list (each line is a SettingsRow, which draws a ui/Row itself)
        : rules.map((r, i) => (
          <SettingsRow key={r.id} id={`approval.${r.id}`} label={approvalLine(r, data.name)} first={i === 0} lead={<Glyph name="key" size={16} />}
            control={<SmallButton label="Remove" testID={`approval-remove-${r.id}`} onPress={() => remove(r)} />} />
        ))}
    </Section>
  );
}
