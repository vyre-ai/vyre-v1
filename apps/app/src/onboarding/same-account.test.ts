import test from "node:test";
import assert from "node:assert/strict";
import { copyAccount, copyableAccounts } from "./same-account.ts";
import type { CapCall } from "../shell/session/caps.ts";

const fake = (answers: Record<string, unknown>) => { const calls: Array<[string, any]> = []; return { calls, call: (async (c: string, i: any) => { calls.push([c, i]); const a = answers[c]; if (a instanceof Error) throw a; return a; }) as unknown as CapCall }; };
const row = (over: Record<string, unknown>) => ({ ref: "#Anthropic", providerId: "prv_1", provider: "anthropic", name: "Anthropic", title: "Anthropic", kind: "api_key", mine: true, itemId: "itm_1", status: "ok", ...over });

test("only a working key in Mine can be copied; a subscription sign-in or a Shared key cannot", async () => {
  const p = fake({ "engine.accounts.list": { accounts: [row({}), row({ providerId: "prv_2", kind: "subscription" }), row({ providerId: "prv_3", mine: false }), row({ providerId: "prv_4", status: "failed" }), row({ providerId: "prv_5", base: "http://localhost:11434" })] } });
  assert.deepEqual((await copyableAccounts(p.call)).map((a) => a.providerId), ["prv_1"], "a local model endpoint is not a key to copy either");
});

test("a yes reveals the one key in the Personal Space and adds it to the team's Mine folder, and nothing else", async () => {
  const personal = fake({ "vault.item.reveal": { fields: [{ key: "api_key", value: "sk-secret-777" }] } });
  const team = fake({ "providers.add": { provider: { id: "prv_new" } } });
  const id = await copyAccount(personal.call, team.call, { providerId: "prv_1", providerKey: "anthropic", name: "Anthropic", itemId: "itm_1" }, "k");
  assert.equal(id, "prv_new");
  assert.deepEqual(personal.calls.map(([c]) => c), ["vault.item.reveal"]);
  assert.deepEqual(team.calls, [["providers.add", { providerKey: "anthropic", connection: "api_key", apiKey: "sk-secret-777", scope: "mine", idempotencyKey: "k" }]]);
});

test("a refusal says so in plain words and never repeats the key; no yes means no calls at all", async () => {
  const personal = fake({ "vault.item.reveal": { fields: [{ key: "api_key", value: "sk-secret-777" }] } });
  const team = fake({ "providers.add": Object.assign(new Error("sk-secret-777 refused"), { code: "validation.bad_input" }) });
  await assert.rejects(() => copyAccount(personal.call, team.call, { providerId: "p", providerKey: "anthropic", name: "A", itemId: "i" }, "k"), (e: Error) => !e.message.includes("sk-secret-777") && /Could not copy/.test(e.message));
  const idle = fake({});
  assert.deepEqual(idle.calls, [], "the offer by itself touches nothing");
});
