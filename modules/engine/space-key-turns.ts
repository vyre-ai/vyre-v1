// A turn on the Space AI key, and on OpenCode Go in general (agent/src/accounts/resolve.ts puts the key after a person's own accounts).
//   model   A member with no account of their own chats with an agent whose model belongs to another provider (Claude, say). On the Space AI key that model cannot run, so the turn runs on the first
//           model the key unlocks (the list the Vault keeps, providers.space_key.get). A model the key serves is kept as chosen.
//   limits  A model the provider refused for its usage limit is remembered for the account (engine_model_limits) until the time the provider said, so the picker greys it with that time and the meter
//           shows it full; the next turn that answers on it clears it. OpenCode Go has no usage endpoint we know of, so its first refusal is what marks the model.
import type { DriverEvent, EngineSession, OpenSession, SessionSpec } from "../../agent/src/turn-engine/types.ts";
import type { Db } from "./projections.ts";
import { clearModelLimit, recordModelLimit } from "./handlers/usage.ts";

type Call = (cap: string, input: unknown, as?: string) => Promise<unknown>;

/** Accounts whose model refusals are remembered per model: the Space AI key and OpenCode Go, which serve many models on one plan. */
const watched = (spec: SessionSpec): boolean => spec.account !== undefined && (spec.account.spaceKey === true || spec.account.driver === "opencode_go");

/** The model a turn on the Space AI key runs: the chosen one when the key serves it, else the first one it unlocks. */
export function fitModel(model: string | undefined, served: readonly string[]): string | undefined {
  if (served.length === 0) return model;
  if (model !== undefined && served.includes(model)) return model;
  return served[0];
}

function watch(session: EngineSession, db: Db, ref: string, model: string, now: () => number): EngineSession {
  return {
    get warm() { return session.warm; },
    get providerLatencyMs() { return session.providerLatencyMs; },
    async *send(input) {
      for await (const ev of session.send(input) as AsyncIterable<DriverEvent>) {
        try {
          if (ev.type === "error" && ev.code === "provider.rate_limited") recordModelLimit(db, ref, model, ev.resetsAt, now());
          else if (ev.type === "done") clearModelLimit(db, ref, model);
        } catch { /* remembering a limit must never fail a turn */ }
        yield ev;
      }
    },
    sendToolResult: (id, r) => session.sendToolResult(id, r),
    inject: (m) => session.inject(m),
    cancel: () => session.cancel(),
    close: () => session.close(),
  } as EngineSession;
}

export function withSpaceKeyTurns(open: OpenSession, d: { call: Call; db: Db; now: () => number }): OpenSession {
  return async (spec) => {
    if (!watched(spec)) return open(spec);
    let agent = spec.agent;
    if (spec.account?.spaceKey === true) {
      const served = await (d.call("providers.space_key.get", {}, spec.asker) as Promise<{ models?: string[] }>).then((r) => r.models ?? [], () => [] as string[]);
      const model = fitModel(agent.model, served);
      if (model !== agent.model && model !== undefined) agent = { ...agent, model };
    }
    const session = await open(agent === spec.agent ? spec : { ...spec, agent });
    return agent.model ? watch(session, d.db, spec.account!.ref, agent.model, d.now) : session;
  };
}
