// A step may name only a thing the person saving it may use (F47, 14 Nov 2026): a mailbox, number, connection, file, record, calendar, form or chat. ONE function decides it, and every path that writes a
// definition reaches it through guardKeySteps (create, update, restore a version, promote, a Personal copy, a package import, a Kit): a path added later is covered the same way.
// The test is the product's own. A connection is a person's own or the Space's, and the connections capability says which the caller may see, so a connection is asked of it (the same rule a Run meets);
// everything else is ctx.authorize at the level the step's capability asks, as the person. Only what the saver wrote or changed is checked (`before`): a stored Automation is left as it is, and its Run
// still stops at the same check, in words. A template ({{ ... }}) cannot be resolved at save: its Run checks it, with the same sentence. A check that cannot be made refuses.
import { registry } from "../../generated/registry.ts";
import { raise } from "./projections.ts";
import type { AutoCtx, Definition } from "./projections.ts";

export interface AccountIssue {
  nodeId: string;
  severity: "error";
  message: string;
}

const THING_WORDS: Readonly<Record<string, string>> = {
  mailbox: "mailbox",
  number: "number",
  connection: "connection",
  file: "file",
  record: "record",
  calendar: "calendar",
  form: "form",
  thread: "chat",
};
const SLOT = /^con_slot[0-9]+$/;
const TEMPLATE = /\{\{/;

type Bound = { field: string; type: string; level: string };

const defsOf = (registry as unknown as { $defs?: Record<string, unknown> }).$defs ?? {};
/** The property names of a step's input schema, with a whole-input `$ref` put in place. */
function propertiesOf(schema: unknown, depth = 0): Record<string, unknown> {
  if (depth > 6 || !schema || typeof schema !== "object") return {};
  const rec = schema as { $ref?: unknown; properties?: Record<string, unknown> };
  if (typeof rec.$ref === "string") return propertiesOf(defsOf[rec.$ref.replace(/^#\/\$defs\//, "")], depth + 1);
  return rec.properties ?? {};
}

let bound: Map<string, Bound> | undefined;
/**
 * Where each step names an existing thing: the input field its capability is bound to (the manifest's own `resource`, so a new step is covered without a list here) and the level the capability asks.
 * A create names its container, which the capability checks as it runs; a Space-wide capability names nothing.
 */
function bindings(): Map<string, Bound> {
  if (bound) return bound;
  const caps = new Map(
    (
      registry.capabilities as unknown as {
        name: string;
        level?: string;
        resource?: { id?: string; type?: string; create?: boolean };
      }[]
    ).map((c) => [c.name, c] as const),
  );
  const out = new Map<string, Bound>();
  for (const st of registry.steps as unknown as { key: string; kind: string; cap?: string; input?: unknown }[]) {
    const c = st.kind === "capability" && st.cap ? caps.get(st.cap) : undefined;
    const field = typeof c?.resource?.id === "string" && c.resource.id.startsWith("/") ? c.resource.id.slice(1) : "";
    if (!c || c.resource?.create === true || field === "" || !(field in propertiesOf(st.input))) continue;
    if (
      c.resource?.type !== undefined &&
      c.resource.type in THING_WORDS &&
      c.level !== undefined &&
      c.level !== "member"
    )
      out.set(st.key, { field, type: c.resource.type, level: c.level });
  }
  // a connector request names the connector in its manifest binding and the account in `connectionId`
  out.set("connector_request", { field: "connectionId", type: "connection", level: "use" });
  return (bound = out);
}

const titleOf = (n: Definition["nodes"][number]): string =>
  n.title?.trim() ||
  (registry.steps as unknown as { key: string; title: string }[]).find((s) => s.key === n.key)?.title ||
  n.key;

/** May the person use this thing now? A connection is asked of the connections capability (a person's own is theirs alone), anything else of the access check. */
async function mayUse(ctx: AutoCtx, b: Bound, id: string): Promise<boolean> {
  if (b.type === "connection") {
    if (!ctx.call) return false;
    try {
      await ctx.call("connections.get", { connectionId: id });
      return true;
    } catch {
      return false;
    }
  }
  if (!ctx.authorize) return false;
  // a "hold" counts as allowed here: the Gate holds the same act again when the step runs, so saving it gives nothing away
  return ctx.authorize({ perm: null, level: b.level }, { type: b.type, id }).effect !== "deny";
}

export async function accountUseIssues(ctx: AutoCtx, def: Definition, before?: Definition): Promise<AccountIssue[]> {
  const was = new Map((before?.nodes ?? []).map((n) => [n.id, n] as const));
  const out: AccountIssue[] = [];
  for (const n of def.nodes) {
    const b = bindings().get(n.key);
    if (!b) continue;
    const id = ({ ...(n.ai ?? {}), ...n.input } as Record<string, unknown>)[b.field];
    const old = was.get(n.id);
    const oldId = old ? ({ ...(old.ai ?? {}), ...old.input } as Record<string, unknown>)[b.field] : undefined;
    // a numbered slot of a shared package (con_slot1) is a blank to fill, not a connection
    if (typeof id !== "string" || id === "" || TEMPLATE.test(id) || SLOT.test(id) || oldId === id) continue;
    if (await mayUse(ctx, b, id)) continue;
    out.push({
      nodeId: n.id,
      severity: "error",
      message: `${titleOf(n)}: you cannot use the ${THING_WORDS[b.type]} it names. Pick another, or ask for access to it.`,
    });
  }
  return out;
}

/** The save-side refusal every path that writes a definition makes (through guardKeySteps). */
export async function guardAccounts(ctx: AutoCtx, before: Definition | undefined, after: Definition): Promise<void> {
  const issue = (await accountUseIssues(ctx, after, before))[0];
  if (issue)
    raise(ctx, "validation.precondition_failed", issue.message, { reason: "account_not_yours", issues: [issue] });
}
