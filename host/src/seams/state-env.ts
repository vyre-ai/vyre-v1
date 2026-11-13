// What a handler hands the state seam so a kind can answer "who can see this thing": the Space's people, and whether one person may open a resource (host/src/seams/state.ts, StateEnv).
// The seam is synchronous and reads only the database; people and access live behind capabilities and the access snapshot, so the handler asks for them first, here.
import type { StateEnv } from "./state.ts";

/** The part of a handler's ctx this needs; the host Ctx satisfies it. */
export interface StateEnvCtx {
  call(cap: string, input: unknown): Promise<unknown>;
  /** each person on their own grants (host/src/invoke.ts); a hand-built test ctx may omit it */
  mayAll?(
    people: readonly string[],
    action: { perm: string | null; level: "view" },
    resource: { type: string; id: string | null },
  ): boolean;
}

const PAGE = 500;
const MAX_PAGES = 20;

/** Every active person of the Space, by access.principals.list. A list that cannot be read is empty: the people the module knows from its own rows still count. */
export async function peopleOf(ctx: Pick<StateEnvCtx, "call">): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  try {
    for (let i = 0; i < MAX_PAGES; i++) {
      const res = (await ctx.call("access.principals.list", {
        kind: "person",
        status: "active",
        limit: PAGE,
        ...(cursor === undefined ? {} : { cursor }),
      })) as { principals?: { id?: unknown; principal?: { id?: unknown } }[]; next?: unknown } | null;
      for (const p of res?.principals ?? []) {
        const id = typeof p.id === "string" ? p.id : typeof p.principal?.id === "string" ? p.principal.id : "";
        if (id) out.push(id);
      }
      cursor = typeof res?.next === "string" && res.next !== "" ? res.next : undefined;
      if (cursor === undefined) break;
    }
  } catch {
    /* an answer that cannot be had is no people */
  }
  return [...new Set(out)];
}

/** The access half of the env: may one person open a resource. Synchronous, so a handler that only asks about one person (state.get, state.set) needs no `await`. */
export function accessEnv(ctx: Pick<StateEnvCtx, "mayAll">): StateEnv {
  return {
    people: [],
    mayView: (person, type, id) => {
      try {
        return ctx.mayAll?.([person], { perm: null, level: "view" }, { type, id }) ?? false;
      } catch {
        return false;
      }
    },
  };
}

/** The env for a call: access is always there; the people are read only when the call needs them (a new entry, a repair), since most calls never do. */
export async function stateEnvOf(ctx: StateEnvCtx, o: { people?: boolean } = {}): Promise<StateEnv> {
  return { ...accessEnv(ctx), people: o.people ? await peopleOf(ctx) : [] };
}
