// Desktop/platform composition for a local-session import. A daemon deliberately
// has no global Space directory; the shell supplies the endpoints it knows.
import { fail } from "../routes/errors.ts";
import type { CtxSeed, Invoke } from "../invoke.ts";

export interface SessionImportEndpoint {
  spaceId: string;
  kind: "personal" | "team";
  owner?: string;
  member(person: string): boolean;
  invoke: Invoke;
}

export interface SessionImportDirectory {
  personal(owner: string): SessionImportEndpoint | undefined;
  team(spaceId: string): SessionImportEndpoint | undefined;
}

/** Build the only cross-Space route local history may use. It carries the
 * original CtxSeed unchanged, and asks the target endpoint about membership. */
export function createSessionDestinationProvider(directory: SessionImportDirectory) {
  const target = (seed: CtxSeed, owner: string, request: { kind: "personal" } | { kind: "team"; spaceId: string }): SessionImportEndpoint => {
    if (owner !== (seed.actingFor ?? seed.principal.id)) throw fail("permission.no_grant", seed.trace?.traceId ?? "0".repeat(32), { message: "That import destination is not available to this caller." });
    const endpoint = request.kind === "personal" ? directory.personal(owner) : directory.team(request.spaceId);
    if (!endpoint || endpoint.kind !== request.kind || (request.kind === "personal" && endpoint.owner !== owner) || (request.kind === "team" && !endpoint.member(owner))) {
      throw fail("permission.no_grant", seed.trace?.traceId ?? "0".repeat(32), { message: "That import destination is not available to this caller." });
    }
    return endpoint;
  };
  return {
    async resolve(a: { owner: string; request: { kind: "personal" } | { kind: "team"; spaceId: string }; seed: CtxSeed }) {
      const endpoint = target(a.seed, a.owner, a.request);
      return { kind: endpoint.kind, spaceId: endpoint.spaceId };
    },
    async invoke(a: { spaceId: string; cap: "sessions.import" | "sessions.continue"; input: unknown; seed: CtxSeed }) {
      const owner = a.seed.actingFor ?? a.seed.principal.id;
      const personal = directory.personal(owner);
      const endpoint = personal?.spaceId === a.spaceId
        ? target(a.seed, owner, { kind: "personal" })
        : target(a.seed, owner, { kind: "team", spaceId: a.spaceId });
      const out = await endpoint.invoke(a.cap, a.input, { ...a.seed, space: endpoint.spaceId });
      if (out.status === "held") throw fail("internal.unavailable", out.traceId, { message: "The destination import is waiting for approval." });
      return out.output;
    },
  };
}
