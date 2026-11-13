// state module helpers: whose state a call is about, the guard for an agent that acts for a person, and how the seam's refusals become the contract's errors.
// The rows and the arithmetic are in host/src/seams/state.ts and lib/state.ts; this file only decides who may ask.
import { fail } from "../../host/src/routes/errors.ts";
import { StateRefusal, stateSeamOf } from "../../host/src/seams/state.ts";
import type { StateStore, Thing } from "../../host/src/seams/state.ts";
import { isHostService } from "../../lib/trust.ts";

export interface StateCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  actingFor?: string | undefined;
  trace: { traceId: string };
  now(): number;
  db: { all(sql: string, ...args: unknown[]): unknown[]; run(sql: string, ...args: unknown[]): { changes: number } };
  emit(
    name: string,
    subject: string,
    payload: unknown,
    opts?: { vis?: "space" | "participants" | "owner" | "private" },
  ): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  /** present on a booted daemon once the host describes many things at once; a test or an older host leaves it out and a row is titled by its id */
  resources?: { describeMany?(refs: readonly Thing[]): readonly { title: string }[] };
  log: { warn(msg: string, attrs?: Record<string, unknown>): void };
}

/** The person whose state a call is about: the person an agent acts for, else the caller. An agent with no one to act for has its own rows. */
export const subjectOf = (ctx: Pick<StateCtx, "principal" | "actingFor">): string => ctx.actingFor ?? ctx.principal.id;

export const storeOf = (ctx: StateCtx): StateStore => stateSeamOf(ctx.db, ctx.now);

/** Run a body that talks to the store: its refusals answer as the contract's errors. */
export async function guarded<T>(ctx: Pick<StateCtx, "trace">, body: () => T | Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (e) {
    if (e instanceof StateRefusal)
      throw fail(e.code === "not_found" ? "validation.not_found" : "validation.bad_input", ctx.trace.traceId, {
        message: e.message,
      });
    throw e;
  }
}

/** Only the server itself makes the internal calls; whatever the gateway let through, a person, an admin or an agent is refused. */
export function hostOnly(ctx: Pick<StateCtx, "principal" | "trace">): void {
  if (!isHostService(ctx.principal))
    throw fail("permission.no_grant", ctx.trace.traceId, { message: "Only the server itself can make this call." });
}

/**
 * Writing for a person by an agent acting for them needs the person's own switch, `state.agents_may_triage`, off by default. A person's own press, and an agent with no one to act for, never need it.
 * A setting that cannot be read counts as off.
 */
export async function mayWrite(ctx: StateCtx): Promise<void> {
  if (ctx.principal.kind !== "agent" || ctx.actingFor === undefined || ctx.actingFor === ctx.principal.id) return;
  let on = false;
  try {
    const s = (await ctx.call("settings.get", { key: "state.agents_may_triage" })) as {
      row?: { value?: unknown };
    } | null;
    on = s?.row?.value === true;
  } catch {
    on = false;
  }
  if (!on)
    throw fail("permission.no_grant", ctx.trace.traceId, {
      message: "This person has not let the assistant mark things for them.",
      next: [
        { kind: "contact_admin", label: "Ask them to turn on Let my assistant mark things for me, in their settings" },
      ],
    });
}
