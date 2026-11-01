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
  | { kind: "unknown"; /** In plain words: why the Vault could not give it (the item is gone, or it has no such field). */ why?: string }
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
  /** Where a failure is explained: the handle and the field NAME it asked for and the code, never a value. */
  log?(msg: string, attrs?: Record<string, unknown>): void;
  invoke: Invoke;
  vault: VaultPort;
  /** The Space the Vault is read for. */
  space: string;
  /** How long a turn waits for a locked Vault key to arrive (the person unlocks in place, or the app is still handing it over after a start) before it reports the Vault as locked. Default 45 s. */
  lockedWaitMs?: number;
  /** How often it looks again while waiting. Default 2 s. */
  lockedPollMs?: number;
  /** For tests. */
  sleep?(ms: number): Promise<void>;
  now?(): number;
}

/** The agent id of an automation AI step that runs as no agent in particular (the same word as modules/engine/step-turn.ts STEP_AGENT; host never imports a module). */
const STEP_AGENT = "step";
const SYSTEM = { kind: "service", id: "svc_host" } as const;
const TRACE_ID = /^[0-9a-f]{32}$/;

/** The code of a failed invoke (a HostError carries the shaped error), or null for anything else. */
function codeOf(e: unknown): string | null {
  const x = e as { error?: { code?: unknown }; code?: unknown } | null;
  const c = x?.error?.code ?? x?.code;
  return typeof c === "string" ? c : null;
}

/** A vault key that is closed: by its reason, or in the words the vault module uses (use.ts) when it throws a plain error. */
function vaultLocked(e: unknown): boolean {
  const x = e as { message?: unknown; details?: { reason?: unknown }; error?: { message?: unknown; details?: { reason?: unknown } } } | null;
  const reason = x?.error?.details?.reason ?? x?.details?.reason;
  const message = x?.error?.message ?? x?.message;
  return reason === "vault_locked" || (typeof message === "string" && /vault key is locked/i.test(message));
}

/** Plain words for a Vault refusal that is not about access: what is wrong with the item or the field the turn asked for. */
function whyUnusable(e: unknown, code: string | null): string {
  const x = e as { message?: unknown; error?: { message?: unknown } } | null;
  const m = String(x?.error?.message ?? x?.message ?? "");
  const field = /no field (\w+)/i.exec(m)?.[1];
  if (field) return `That account's Vault item has no ${field} field. Sign in to it again.`;
  return code === "validation.not_found" ? "The Vault item for that account is gone or not shared with you. Sign in to it again." : "The Vault could not use that account's item. Sign in to it again.";
}

/** An error the turn engine reads the code of (agent/src/turn-engine/engine.ts), so the failure reaches the chat under that code. */
function coded(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

export function createEngineSessionHost(d: EngineSessionHostDeps): EngineSessionHost {
  /** An engine trace id is 32 hex; one that is not (a test double) is left out and the pipeline starts its own. */
  const traceOf = (id: string): Pick<CtxSeed, "trace"> => (TRACE_ID.test(id) ? { trace: { traceId: id, spanId: "0".repeat(16) } } : {});

  const lookupOnce = async (handle: string, who: { agentId: string; asker: string; where: "host" | "device" | "computer" }): Promise<VaultLookup> => {
        // Only a Vault handle is looked up; a sealed record field or a hashtag the model wrote is not one.
        if (!HANDLE.test(handle)) return { kind: "unknown" };
        const [item = "", field] = handle.slice(1).split(".");
        try {
          // A chat turn is an agent acting for a person. An automation's AI step that names no agent has none in the chat sense: it is the person's own Run, or a Space automation's own service,
          // so the key is asked for as that principal (the step's marker is "step", as in modules/engine/step-turn.ts). A service reads Shared items only.
          const agentic = who.agentId !== STEP_AGENT;
          const service = !agentic && who.asker.startsWith("svc_");
          const r = await d.invoke(
            "vault.use",
            { item, ...(field === undefined ? {} : { fields: [field] }), purpose: "engine account" },
            agentic
              ? { space: d.space, principal: { kind: "agent", id: who.agentId }, actingFor: who.asker, origin: "engine" }
              : { space: d.space, principal: { kind: service ? "service" : "person", id: who.asker }, origin: "engine" },
          );
          if (r.status !== "ok") return { kind: "denied", reason: "no_access" };
          const itemId = (r.output as { itemId?: unknown } | null)?.itemId;
          if (typeof itemId !== "string") return { kind: "unknown" };
          const value = await d.vault.secret(handle, d.space, service ? undefined : who.asker);
          return { kind: "value", itemId, value, spaceOnly: false, injectIntoDeployments: false };
        } catch (e) {
          const code = codeOf(e);
          if (code === "permission.provider_label") return { kind: "denied", reason: "provider_label" };
          if (code !== null && code.startsWith("permission.")) return { kind: "denied", reason: "no_access" };
          // Not the same as "no account": the item is gone, or it has no such field. Say which, in plain words, and log the field NAME (never a value) so the next one explains itself.
          if (code === "validation.not_found" || code === "validation.bad_input") {
            d.log?.("the vault could not give the account its key", { code, handle: item, field: field ?? null, why: whyUnusable(e, code) });
            return { kind: "unknown", why: whyUnusable(e, code) };
          }
          // Never the original text: it may carry request text. A locked key and every other refusal carry a code of their own, so the chat shows an Unlock card or a precise reason, not "did not finish".
          if (vaultLocked(e)) throw coded("engine.vault_locked", "Your Vault is locked on this computer.");
          throw coded("engine.vault_unreadable", code !== null ? `The Vault could not be read (${code}).` : "The Vault could not be read.");
        }
  };

  return {
    source: {
      async lookup(handle, who) {
        // A locked key is waited for, not failed on: right after a start the app is still handing the key over, and a person who sees Unlock can do it in place. The turn goes on by itself the moment the key is there.
        const deadline = (d.now ?? Date.now)() + (d.lockedWaitMs ?? 45_000);
        for (;;) {
          try { return await lookupOnce(handle, who); }
          catch (e) {
            if (codeOf(e) !== "engine.vault_locked" || (d.now ?? Date.now)() >= deadline) throw e;
            await (d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(d.lockedPollMs ?? 2_000);
          }
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
