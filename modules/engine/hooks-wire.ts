// Binds the hooks layer to the engine host (lane l-hooks): the port the tool session, the MCP endpoint and the turn engine ask, and what the hooks module needs from the engine side (the sandbox that runs
// a command hook, the plugin hooks, and an action through the normal invoke pipeline as the agent).
import { bindHooksPort } from "../../agent/src/tools/hooks.ts";
import type { HooksPort } from "../../agent/src/tools/hooks.ts";
import { bindHooks } from "../../lib/hooks-host.ts";
import { hooksPortOf } from "./hooks-port.ts";
import { pluginRuntime } from "./plugin-host.ts";
import { completerOf, providerOfDriver } from "./runtime.ts";
import { parseCheck } from "../../lib/hooks.ts";
import { CHECK_SYSTEM } from "../hooks/eval.ts";
import type { ResolvedAccount } from "../../agent/src/turn-engine/types.ts";
import type { Invoke } from "../../host/src/invoke.ts";

export function wireHooks(h: { call(cap: string, input: unknown, as?: string): Promise<unknown>; invoke?: Invoke; space?: string; log?: (msg: string, attrs?: Record<string, unknown>) => void }): HooksPort {
  const port = hooksPortOf(h.call, h.log);
  bindHooksPort(port);
  const rt = () => { const r = pluginRuntime(); if (!r) throw new Error("there is no sandbox to run a hook in"); return r; };
  bindHooks({
    command: (who, hook, event) => rt().runCommand(hook, who, event),
    plugin: (who, hook, event) => rt().runHook(hook, who, event),
    pluginHooks: async (who) => ((await h.call("plugins.hooks.list", { agentId: who.agentId }, who.asker).catch(() => ({ hooks: [] }))) as { hooks: never[] }).hooks,
    // a check is read by a small model on the asker's own AI account: the account that would pay for an agent's own work in this chat, run through the same one-shot opener memory upkeep uses
    check: async (who, instruction, event) => {
      const run = completerOf();
      if (!run || !who.threadId) return null;
      const acct = (await h.call("engine.account.resolve", { threadId: who.threadId, agentId: who.agentId, askerId: who.asker }, who.asker)) as { accountRef?: string | null; allowed?: boolean } | undefined;
      if (!acct?.accountRef || acct.allowed === false) return null;
      const list = (await h.call("engine.accounts.list", {}, who.asker)) as { accounts: Array<{ ref: string; driver: string; kind: "api_key" | "subscription"; base?: string; keyless?: boolean; itemId?: string }> };
      const row = list.accounts.find((a) => a.ref === acct.accountRef);
      if (!row) return null;
      const account = { ref: row.ref, driver: row.driver, provider: providerOfDriver(row.driver), kind: row.kind, payer: who.asker, reason: "starter", ...(row.itemId ? { itemId: row.itemId } : {}), ...(row.base ? { base: row.base } : {}), ...(row.keyless ? { keyless: true } : {}) } as ResolvedAccount;
      const out = await run({ account, agentId: who.agentId, system: CHECK_SYSTEM, prompt: `Rule: ${instruction}\n\nEvent:\n${JSON.stringify(event).slice(0, 6000)}` });
      return parseCheck(out.text);
    },
    action: async (who, cap, input) => {
      // the normal pipeline, as the agent acting for the asker: access, the Gate and the audit all apply, and a held act stays held
      if (!h.invoke || !h.space) return h.call(cap, input, who.asker);
      const r = await h.invoke(cap, input, { space: h.space, principal: { kind: "agent", id: who.agentId }, actingFor: who.asker, origin: "engine", ...(who.threadId ? { thread: who.threadId } : {}) });
      return r.status === "ok" ? r.output : { held: true };
    },
  });
  return port;
}
