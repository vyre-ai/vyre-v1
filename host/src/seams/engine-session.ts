// The host ports the engine's session opener stands on (packet P-L2_23c; the opener itself is agent/src/drivers/open, which the engine module builds with these).
// Layer rule (boundaries.json): host never imports agent or modules, so everything here is a plain structural port the module passes on, the way events-ports.ts is.
//
//   source     Vault lookup for a handle, for an agent acting for a person. Access is the vault.use capability through the invoke pipeline (level use, the label-vs-provider rule, the audit
//              row); only after it says yes is the value read from the Vault port. The value leaves this file in one return and is never logged, stored or put in an error.
//   reportMiss vault.report_scrub_miss with ids and place only.
//   mcp        mcp.session.mint and mcp.session.close for the loopback endpoint of a CLI engine: a token that encodes the agent, the person it acts for and the thread.
import type { CtxSeed, Invoke } from "../invoke.ts";
import { HANDLE } from "./ports.ts";
import type { VaultPort } from "./ports.ts";

export type VaultLookup =
  | { kind: "value"; itemId: string; value: string; spaceOnly: boolean; injectIntoDeployments: boolean }
  | { kind: "unknown" }
  | { kind: "denied"; reason: "no_access" | "provider_label" | "other" };

export interface EngineSessionHost {
  source: { lookup(handle: string, who: { agentId: string; asker: string; where: "host" | "device" | "computer" }): Promise<VaultLookup> };
  reportMiss(r: { itemId: string; place: "terminal" | "http" | "browser" | "file" | "chat"; traceId: string }): Promise<void>;
  mcp: {
    mint(i: { principal: string; actingFor: string; threadId: string; traceId: string }): Promise<{ sessionId: string; sessionToken: string; url: string; expiresAt: number }>;
    close(sessionId: string): Promise<void>;
  };
}

export interface EngineSessionHostDeps {
  invoke: Invoke;
  vault: VaultPort;
  /** The Space the Vault is read for. */
  space: string;
}

const SYSTEM = { kind: "service", id: "svc_host" } as const;
const TRACE_ID = /^[0-9a-f]{32}$/;

/** The code of a failed invoke (a HostError carries the shaped error), or null for anything else. */
function codeOf(e: unknown): string | null {
  const x = e as { error?: { code?: unknown }; code?: unknown } | null;
  const c = x?.error?.code ?? x?.code;
  return typeof c === "string" ? c : null;
}

export function createEngineSessionHost(d: EngineSessionHostDeps): EngineSessionHost {
  /** An engine trace id is 32 hex; one that is not (a test double) is left out and the pipeline starts its own. */
  const traceOf = (id: string): Pick<CtxSeed, "trace"> => (TRACE_ID.test(id) ? { trace: { traceId: id, spanId: "0".repeat(16) } } : {});

  return {
    source: {
      async lookup(handle, who) {
        // Only a Vault handle is looked up; a sealed record field or a hashtag the model wrote is not one.
        if (!HANDLE.test(handle)) return { kind: "unknown" };
        const [item = "", field] = handle.slice(1).split(".");
        try {
          const r = await d.invoke(
            "vault.use",
            { item, ...(field === undefined ? {} : { fields: [field] }), purpose: "engine account" },
            { space: d.space, principal: { kind: "agent", id: who.agentId }, actingFor: who.asker, origin: "engine" },
          );
          if (r.status !== "ok") return { kind: "denied", reason: "no_access" };
          const itemId = (r.output as { itemId?: unknown } | null)?.itemId;
          if (typeof itemId !== "string") return { kind: "unknown" };
          const value = await d.vault.secret(handle, d.space);
          return { kind: "value", itemId, value, spaceOnly: false, injectIntoDeployments: false };
        } catch (e) {
          const code = codeOf(e);
          if (code === "permission.provider_label") return { kind: "denied", reason: "provider_label" };
          if (code !== null && code.startsWith("permission.")) return { kind: "denied", reason: "no_access" };
          if (code === "validation.not_found" || code === "validation.bad_input") return { kind: "unknown" };
          throw new Error(code !== null ? `The Vault could not be read (${code}).` : "The Vault could not be read.");   // never the original: it may carry request text
        }
      },
    },

    async reportMiss(r) {
      await d.invoke("vault.report_scrub_miss", r, { space: d.space, principal: { ...SYSTEM }, preAuth: true, origin: "engine", ...traceOf(r.traceId) });
    },

    mcp: {
      async mint(i) {
        const r = await d.invoke(
          "mcp.session.mint",
          { principal: i.principal, actingFor: i.actingFor, threadId: i.threadId, traceId: i.traceId },
          { space: d.space, principal: { ...SYSTEM }, preAuth: true, origin: "engine", thread: i.threadId, ...traceOf(i.traceId) },
        );
        if (r.status !== "ok") throw new Error("The loopback session was held instead of minted.");
        return r.output as { sessionId: string; sessionToken: string; url: string; expiresAt: number };
      },
      async close(sessionId) {
        await d.invoke("mcp.session.close", { sessionId }, { space: d.space, principal: { ...SYSTEM }, preAuth: true, origin: "engine" });
      },
    },
  };
}
