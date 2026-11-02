// What an automation asks the Gate to hold after a press: the outward steps of its definition, each with its act and the targets it names (chat design, hole 1). The Gate decides who may write them:
// this file says what the steps are, and calls after every definition change, so a save by anyone but a person leaves the automation with no grant.
import { definitionHash, targetIsComputed, targetsOf } from "../../lib/grants.ts";
import { registry } from "../../generated/registry.ts";
import { allAutomations } from "./projections.ts";
import type { AutoCtx, Automation, Definition, Node } from "./projections.ts";

const STEPS = new Map((registry.steps as unknown as { key: string; effects?: string; cap?: string }[]).map((s) => [s.key, s] as const));
const CAPS = new Map((registry.capabilities as unknown as { name: string; gate?: { act?: string } }[]).map((c) => [c.name, c] as const));

/** The Gate act of a step, when it has an outward one. An HTTP step that only reads and a mail step that only drafts have none. */
function actOf(n: Node): string | undefined {
  if (n.key === "code") return Array.isArray(n.input?.["hosts"]) && n.input["hosts"].length > 0 ? "send" : undefined;   // the sandbox opens to the hosts a code step names
  const s = STEPS.get(n.key);
  if (!s || s.effects !== "outward" || !s.cap) return undefined;
  if (n.key === "http_request" && /^(GET|HEAD)$/i.test(String(n.input?.["method"] ?? "GET"))) return undefined;
  if (n.key === "send_email" && n.input?.["draftOnly"] === true) return undefined;
  const act = CAPS.get(s.cap)?.gate?.act;
  return act && act !== "none" ? act : undefined;
}

const sameStep = (a: Node, b: Node | undefined): boolean => b !== undefined && a.key === b.key && JSON.stringify(a.input) === JSON.stringify(b.input);

export interface StepGrant { stepId: string; act: string; targets: string[]; computed: boolean; changed: boolean }

/** The outward steps of a definition. `changed` says this save wrote the step; everything is written when there was nothing before. */
export function outwardSteps(def: Definition, before?: Definition): StepGrant[] {
  const was = new Map((before?.nodes ?? []).map((n) => [n.id, n] as const));
  const out: StepGrant[] = [];
  for (const n of def.nodes) {
    const act = actOf(n);
    if (act !== undefined) out.push({ stepId: n.id, act, targets: targetsOf(n.input), computed: targetIsComputed(n.input), changed: !sameStep(n, was.get(n.id)) });
  }
  return out;
}

/**
 * Tell the Gate the automation's definition as it stands. The Gate writes rows only for a person's press and clears them for anyone else. A failure leaves nothing to spend: the hash no longer matches, so
 * the next Run holds rather than sends.
 */
export async function regrant(ctx: AutoCtx, a: Automation, press: "save" | "on", before?: Definition): Promise<void> {
  if (!ctx.call) return;
  try {
    await ctx.call("gate.grants.set", { automationId: a.id, defHash: await definitionHash(a.definition), press, steps: outwardSteps(a.definition, press === "on" ? a.definition : before) });
  } catch (e) { ctx.log?.warn("automation grants were not written", { automationId: a.id, error: e instanceof Error ? e.message : String(e) }); }
}

const BACKFILLED = "automations.grants_backfilled";

/**
 * Automations saved before grants existed hold none, so every one of them would stop at its next send. A person wrote the ones whose latest version a person saved: they get their rows once, as the save would
 * have written them. The latest version an agent saved gets nothing: that is the hole this closes. The server writes these, not a press, because the press happened before the row could be kept.
 */
export async function backfillGrants(ctx: AutoCtx): Promise<number> {
  if (ctx.db.all("SELECT 1 AS x FROM automations_policy WHERE policy_key = ?", BACKFILLED).length > 0 || !ctx.call) return 0;
  let done = 0;
  for (const a of allAutomations(ctx.db)) {
    const by = (ctx.db.all("SELECT by_who FROM automations_versions WHERE automation_id = ? AND n = ?", a.id, a.version) as { by_who?: unknown }[])[0]?.by_who;
    if (typeof by !== "string" || !by.startsWith("usr_")) continue;
    await ctx.call("gate.grants.set", { automationId: a.id, defHash: await definitionHash(a.definition), press: "save", steps: outwardSteps(a.definition) });
    done += 1;
  }
  ctx.db.run("INSERT OR REPLACE INTO automations_policy (policy_key, policy_value) VALUES (?, ?)", BACKFILLED, "true");
  return done;
}
