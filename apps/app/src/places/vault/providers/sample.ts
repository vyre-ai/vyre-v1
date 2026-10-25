// The sample behind the provider, health and import screens: the Vault sample plus the capabilities these screens call (providers.catalog, test, add, subscription sign-in, remove,
// set_space_use, and the import parse and run). Every one changes the sample replica, so each control in a mount really works. The values are made up.
import type { Row } from "../../../../../../client/src/index.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { VaultData } from "../layout/data.tsx";
import type { Provider } from "../layout/model.ts";
import { SAMPLE_NOW } from "../layout/sample.ts";
import type { SampleVault } from "../layout/sample.ts";
import type { Catalog } from "./model.ts";
import type { Parsed } from "../import/model.ts";

export const CATALOG: readonly Catalog[] = [
  { key: "claude-code", name: "Claude", connections: ["subscription", "api_key"], modelsSource: "anthropic", engine: "claude-code" },
  { key: "openai", name: "OpenAI", connections: ["api_key"], modelsSource: "openai", engine: "codex" },
  { key: "anthropic", name: "Anthropic", connections: ["api_key"], modelsSource: "anthropic", engine: "claude-code" },
  { key: "opencode-go", name: "OpenCode Go", connections: ["api_key"], modelsSource: "opencode", engine: "opencode" },
  { key: "grok", name: "Grok", connections: ["subscription", "api_key"], modelsSource: "xai", engine: "grok" },
  { key: "ollama", name: "Local models", connections: ["local_model"], modelsSource: "ollama", engine: "opencode" },
];

/** What an export file holds in the sample: a few logins, one already in the Vault, one with a warning. */
export const IMPORT_ITEMS: readonly Parsed[] = [
  { name: "Notion", kind: "login", fieldKeys: ["USERNAME", "PASSWORD"], warnings: [] },
  { name: "GitHub", kind: "login", fieldKeys: ["USERNAME", "PASSWORD"], duplicateOf: "vit_github", warnings: [] },
  { name: "Linear", kind: "login", fieldKeys: ["USERNAME", "PASSWORD", "TOTP"], warnings: [] },
  { name: "Company card", kind: "card", fieldKeys: ["CARD_NUMBER", "EXPIRY", "CVV"], warnings: ["no billing address"] },
  { name: "Wi-Fi at the studio", kind: "note", fieldKeys: [], warnings: [] },
];

export interface ProviderSample extends SampleVault {
  /** files the sample's file chooser handed out */
  picked: string[];
}

/** Wraps a Vault sample so the provider, health and import capabilities answer; every other call goes to the sample itself. */
export function withProviders(base: SampleVault, o: { importItems?: readonly Parsed[]; pick?: string | null } = {}): ProviderSample {
  const { replica } = base;
  const picked: string[] = [];
  const flows = new Map<string, { providerKey: string }>();
  let seq = 0;
  const providers = (): (Provider & Row)[] => replica.rows("providers") as unknown as (Provider & Row)[];
  const meOwner = base.data.me.id;

  const addProvider = (c: Catalog, connection: Provider["connection"], scope: Provider["scope"], address?: string): Provider => {
    const n = ++seq;
    const itemId = `vit_prov${n}`;
    const folder = (replica.rows("folders") as unknown as { id: string; scope: string }[]).find((f) => f.scope === (scope === "mine" ? "mine" : "shared"))?.id ?? "fld_mine";
    replica.put("items", [{
      id: itemId, name: connection === "subscription" ? c.name : `${c.name} key`, kind: connection === "subscription" ? "ai_subscription" : "api_key", folderId: folder, owner: meOwner, scope,
      fieldKeys: [connection === "api_key" ? `${c.key.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY` : connection === "local_model" ? "OLLAMA_HOST" : "SETUP_TOKEN"], handle: `#Sample_${c.name}`, spaceOnly: false,
      injectIntoDeployments: false, yourLevel: "manage", label: 0, createdAt: SAMPLE_NOW, updatedAt: SAMPLE_NOW, lastUsedAt: SAMPLE_NOW,
    } as unknown as Row]);
    const p: Provider = {
      id: `prv_new${n}`, providerKey: c.key, name: c.name, connection, scope, itemId, agentsUsing: [], usage: { tokens: 0, costCents: 0, periodStart: Date.UTC(2025, 9, 1) }, engine: c.engine, spaceMayUse: false, state: "ok",
      via: connection === "subscription" ? `Sign in with ${c.name}` : connection === "local_model" ? `Local model at ${address ?? "this computer"}` : `API key #Sample_${c.name.replace(/\s+/g, "_")}_Key`,
    };
    replica.put("providers", [p as unknown as Row]);
    return p;
  };
  const catalogOf = (key: string): Catalog => { const c = CATALOG.find((x) => x.key === key); if (!c) throw new Error(`No provider called ${key}`); return c; };

  const writes: Record<string, (input: never) => unknown> = {
    "providers.catalog": () => ({ providers: [...CATALOG] }) satisfies CapMap["providers.catalog"]["out"],
    "providers.test": (i: { providerId: string }) => {
      const p = providers().find((x) => x.id === i.providerId);
      if (!p) throw new Error("No such provider");
      return p.state === "failing" ? { ok: false, models: [], latencyMs: 0, detail: "The key was refused." } : { ok: true, models: p.connection === "local_model" ? ["llama3.1", "qwen2.5"] : p.providerKey === "claude-code" ? ["Opus", "Sonnet", "Haiku"] : ["model-large", "model-small", "model-fast"], latencyMs: 240 };
    },
    "providers.add": (i: CapMap["providers.add"]["in"]) => {
      if (i.connection === "api_key" && !i.apiKey?.trim()) throw new Error("Paste the key first.");
      if (i.connection === "local_model" && !i.address) throw new Error("Give the address first.");
      return { provider: addProvider(catalogOf(i.providerKey), i.connection, i.connection === "local_model" ? "mine" : i.scope, i.address) };
    },
    "providers.subscription_start": (i: { providerKey: string }) => {
      const c = catalogOf(i.providerKey);
      const flowId = `flow${++seq}`;
      flows.set(flowId, { providerKey: c.key });
      return { flowId, instruction: `Open the address below, sign in to ${c.name}, and enter this code when it asks.`, url: `https://auth.example/${c.key}/device`, userCode: "KQ7M-2XPD" };
    },
    "providers.subscription_complete": (i: { flowId: string }) => {
      const f = flows.get(i.flowId);
      if (!f) throw new Error("That sign-in was not started.");
      return { provider: addProvider(catalogOf(f.providerKey), "subscription", "mine") };
    },
    "providers.set_space_use": (i: { providerId: string; allow: boolean }) => {
      const p = providers().find((x) => x.id === i.providerId);
      if (!p) throw new Error("No such provider");
      if (p.connection === "subscription") throw new Error("A subscription sign-in cannot be shared.");
      replica.put("providers", [{ ...p, spaceMayUse: i.allow } as unknown as Row]);
      return { ok: true };
    },
    "providers.remove": (i: { providerId: string }) => {
      const p = providers().find((x) => x.id === i.providerId);
      if (!p) throw new Error("No such provider");
      replica.put("items", [{ ...(replica.rows("items") as unknown as Row[]).find((r) => r.id === p.itemId)!, trashed: true } as unknown as Row]);
      replica.remove("providers", [p.id]);
      return { ok: true };
    },
    "vault.import_parse": () => ({ items: [...(o.importItems ?? IMPORT_ITEMS)] }) satisfies CapMap["vault.import_parse"]["out"],
    "vault.import": (i: CapMap["vault.import"]["in"]) => {
      const items = o.importItems ?? IMPORT_ITEMS;
      const dup = items.filter((p) => p.duplicateOf).length;
      const fresh = items.length - dup;
      if (i.dedupe === "skip") return { created: fresh, updated: 0, skipped: dup };
      if (i.dedupe === "overwrite") return { created: fresh, updated: dup, skipped: 0 };
      return { created: items.length, updated: 0, skipped: 0 };
    },
  };

  const data: VaultData = {
    ...base.data,
    async call(cap, input) {
      const w = writes[cap];
      if (!w) return base.data.call(cap, input);
      base.calls.push({ cap, input });
      return w(input as never);
    },
    async pickFile() {
      const id = o.pick === undefined ? "file_export1" : o.pick;
      if (id) picked.push(id);
      return id;
    },
  };
  return { ...base, data, picked };
}
