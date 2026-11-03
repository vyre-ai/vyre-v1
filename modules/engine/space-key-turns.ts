// A turn on the Space AI key, and on OpenCode Go in general (agent/src/accounts/resolve.ts puts the key after a person's own accounts), and a turn moved to a Space account's default model.
//   model   A member with no account of their own chats with an agent whose model belongs to another provider (Claude, say). On the Space AI key that model cannot run, so the turn runs on the first
//           model the key unlocks (the list the Vault keeps, providers.space_key.get). A model the key serves is kept as chosen, unless it is out of usage and another one is not.
//   limits  A model the provider refused for its usage limit is remembered for the account (engine_model_limits) until the time the provider said, so the picker greys it with that time and the meter
//           shows it full; the next turn that answers on it clears it. OpenCode Go has no usage endpoint we know of, so its first refusal is what marks the model.
//   no cold failure  On the Space AI key, a refusal for usage before the turn said anything moves the turn to the next model the key serves that is not out; only when none is left does the refusal
//           reach the turn engine, which then tries the next account (switch-on-limit.ts).
import type { DriverEvent, EngineSession, OpenSession, SessionSpec, ToolResult, StoredMessage } from "../../agent/src/turn-engine/types.ts";
import type { Db } from "./projections.ts";
import { clearModelLimit, modelLimits, recordModelLimit } from "./handlers/usage.ts";

type Call = (cap: string, input: unknown, as?: string) => Promise<unknown>;

/** Accounts whose model refusals are remembered per model: the Space AI key and OpenCode Go, which serve many models on one plan. */
const watched = (spec: SessionSpec): boolean => spec.account !== undefined && (spec.account.spaceKey === true || spec.account.driver === "opencode_go");

/** The model a turn on the Space AI key runs: the chosen one when the key serves it and it is not out, else the first one it serves that is not out, else the first one it serves. */
export function fitModel(model: string | undefined, served: readonly string[], out: ReadonlySet<string> = new Set()): string | undefined {
  if (served.length === 0) return model;
  if (model !== undefined && served.includes(model) && !out.has(model)) return model;
  return served.find((m) => !out.has(m)) ?? (model !== undefined && served.includes(model) ? model : served[0]);
}

export function withSpaceKeyTurns(open: OpenSession, d: { call: Call; db: Db; now: () => number }): OpenSession {
  return async (asked) => {
    // no account serving the chat's model could pay (owner ruling 9): the turn runs on the account's default model (model-fallback.ts says so in the chat)
    const swap = asked.account?.modelFallback;
    const spec: SessionSpec = swap ? { ...asked, agent: swap.to ? { ...asked.agent, model: swap.to } : (({ model: _asked, ...rest }) => rest)(asked.agent) } : asked;
    if (!watched(spec)) return open(spec);
    const ref = spec.account!.ref;
    const outNow = (): Set<string> => new Set(modelLimits(d.db, ref, d.now()).keys());
    const served = spec.account?.spaceKey === true
      ? await (d.call("providers.space_key.get", {}, spec.asker) as Promise<{ models?: string[] }>).then((r) => r.models ?? [], () => [] as string[])
      : [];
    const opened = async (model: string | undefined): Promise<{ session: EngineSession; model: string | undefined }> => {
      const agent = model === spec.agent.model || model === undefined ? spec.agent : { ...spec.agent, model };
      return { session: await open(agent === spec.agent ? spec : { ...spec, agent }), model: agent.model };
    };
    let cur = await opened(fitModel(spec.agent.model, served, outNow()));
    const tried = new Set<string>();
    const note = (fn: () => void): void => { try { fn(); } catch { /* remembering a limit must never fail a turn */ } };
    return {
      get warm() { return cur.session.warm; },
      get providerLatencyMs() { return cur.session.providerLatencyMs; },
      async *send(input) {
        for (;;) {
          let said = false;
          let moved = false;
          for await (const ev of cur.session.send(input) as AsyncIterable<DriverEvent>) {
            if (ev.type === "text" || ev.type === "tool_call" || ev.type === "block") said = true;
            const model = cur.model;
            if (ev.type === "error" && ev.code === "provider.rate_limited" && model) {
              note(() => recordModelLimit(d.db, ref, model, ev.resetsAt, d.now()));
              tried.add(model);
              const next = said ? undefined : served.find((m) => !tried.has(m) && !outNow().has(m));
              if (next !== undefined) {
                await cur.session.close().catch(() => undefined);
                cur = await opened(next);
                moved = true;
                break;
              }
            } else if (ev.type === "done" && model) note(() => clearModelLimit(d.db, ref, model));
            yield ev;
          }
          if (!moved) return;
        }
      },
      sendToolResult: (id: string, r: ToolResult) => cur.session.sendToolResult(id, r),
      inject: (m: StoredMessage) => cur.session.inject(m),
      cancel: () => cur.session.cancel(),
      close: () => cur.session.close(),
    } as EngineSession;
  };
}
