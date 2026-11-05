// Two helpers on two models and two accounts, end to end on a booted daemon (owner, 4 Nov 2026; prototype p-crew scene crewmodels). A person asks for "two helpers: one on GPT-6 from my OpenAI, one on GLM from
// the Space OpenCode". Both accounts are real rows in the Vault (a key of the person's own and a Space key, the vendors' answers faked), so engine.helper_models lists them with their models and the lead's
// pick is checked against them. The lead starts two helpers, each on its own model and account; the one read the strip uses (engine.crew.status) says which, and the sentences the strip shows follow from it.
import test from "node:test";
import assert from "node:assert/strict";
import { claimedSpace, hostLog, scriptedModel, stop, waitFor } from "./support/eco-live.ts";
import { modelsLine, rowModel } from "../apps/app/src/places/chats/crew/model.ts";

type Json = any;   // eslint-disable-line @typescript-eslint/no-explicit-any

/** The vendors' answers: each key lists its models, and a one-token chat works (the OpenCode check does one). */
const vendors = async (url: string): Promise<{ status: number; ok: boolean; json(): Promise<unknown>; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }> => {
  const reply = (json: unknown) => ({ status: 200, ok: true, json: async () => json, text: async () => JSON.stringify(json), arrayBuffer: async () => new ArrayBuffer(0) });
  if (url === "https://api.openai.com/v1/models") return reply({ data: [{ id: "gpt-6" }, { id: "gpt-5" }] });
  if (url === "https://opencode.ai/inference/go/v1/models") return reply({ data: [{ id: "glm-5.2" }, { id: "kimi-k3" }] });
  if (url.includes("opencode.ai/inference/go/openai/v1/chat/completions")) return reply({ choices: [{ message: { content: "ok" } }] });
  return { status: 404, ok: false, json: async () => ({}), text: async () => "{}", arrayBuffer: async () => new ArrayBuffer(0) };
};

test("two helpers, two models, two accounts: the lead's picks are checked against the catalogue, each helper runs on what it was given, and the strip's sentences say so", async () => {
  let lead = ""; let chat = "";
  let picks: Array<{ title: string; instruction: string; model: string; account: string }> = [];
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id !== lead) return;
    const body = input.trigger?.body ?? "";
    if (input.threadId === chat) {
      if (/two helpers/.test(body)) {
        yield* run("tool_search", { query: "sub task helper" });
        for (const [i, p] of picks.entries()) yield* run("sub_task_model", { threadId: input.threadId, title: p.title, instruction: p.instruction, model: p.model, account: p.account, why: "you asked", idempotencyKey: `cmod-${i}` });
        yield { type: "text", text: "Two helpers started." };
      }
      return;
    }
    yield { type: "text", text: `done: ${input.trigger?.body?.slice(0, 30) ?? ""}` };
  });
  const s = await claimedSpace(model, "Crew Co", { providerFetch: vendors });
  lead = s.assistant;
  try {
    // the person's own OpenAI key and the Space's OpenCode key, as accounts with names a person reads
    const mine = (await s.api("vault.folders.list", { scope: "mine" })).folders[0].id as string;
    const openai = (await s.api("providers.add", { idempotencyKey: "cmod-openai", providerKey: "openai", connection: "api_key", apiKey: "sk-live-TESTopenaiKEY0123456789", name: "Irfad's OpenAI", scope: "mine", folderId: mine })).provider;
    const shared = (await s.api("vault.folders.create", { idempotencyKey: "cmod-sf", name: "Space AI", scope: "shared" })).folder.id as string;
    const opencode = (await s.api("providers.add", { idempotencyKey: "cmod-oc", providerKey: "opencode-go", connection: "api_key", apiKey: "oc-live-TESTopencodeKEY0123456789", name: "Space OpenCode", scope: "shared", folderId: shared })).provider;
    // accounts read by the name a person gave the item in the Vault
    await s.api("vault.item.update", { idempotencyKey: "cmod-n1", itemId: openai.itemId, name: "Irfad's OpenAI" });
    await s.api("vault.item.update", { idempotencyKey: "cmod-n2", itemId: opencode.itemId, name: "Space OpenCode" });
    // the models each account lists come from asking it once (what the Models page does), so the catalogue is what a person would see
    for (const p of [openai, opencode]) await s.api("engine.models.list", { accountRef: p.handle });

    chat = (await s.api("chat.start", { kind: "chat", agentIds: [lead], title: "Vendor quotes", idempotencyKey: "cmod-chat" })).thread.threadId as string;
    const cat = await s.api("engine.helper_models", { threadId: chat, agentId: lead });
    const accounts = cat.accounts as Json[];
    const gpt = accounts.find((a) => a.provider === "openai" && a.models.some((m: Json) => m.model === "gpt-6" && m.available));
    const glm = accounts.find((a) => a.provider.startsWith("opencode") && a.models.some((m: Json) => m.model === "glm-5.2" && m.available));
    assert.ok(gpt, `GPT-6 is in the catalogue on the person's OpenAI: ${JSON.stringify(accounts.map((a) => [a.label, a.models.map((m: Json) => m.model)]))}`);
    assert.ok(glm, "GLM 5.2 is in the catalogue on the Space OpenCode");
    assert.match(gpt.label, /Irfad's OpenAI/);
    assert.match(glm.label, /Space OpenCode/);
    picks = [
      { title: "Compare quotes", instruction: "Compare the Harbor Supply quote with the Pine Works quote.", model: "gpt-6", account: gpt.ref },
      { title: "northwind.com", instruction: "Read northwind.com and note how it describes vendor onboarding.", model: "glm-5.2", account: glm.ref },
    ];

    await s.api("chat.post", { threadId: chat, body: "Get two helpers: one on GPT-6 from my OpenAI to compare the quotes, one reading northwind.com with GLM from the Space OpenCode.", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "cmod-ask" });
    const crew = await waitFor(async () => { const r = await s.api("engine.crew.status", { threadId: chat }); return (r.members as Json[]).length === 2 && (r.members as Json[]).every((m) => m.model) ? r : null; }, 60_000, () => hostLog(s.d));
    const members = crew.members as Json[];
    const orin = members.find((m) => m.title === "Compare quotes")!;
    const pia = members.find((m) => m.title === "northwind.com")!;
    assert.deepEqual([orin.model, pia.model], ["gpt-6", "glm-5.2"], "each helper runs on the model it was given");
    assert.match(orin.accountLabel, /Irfad's OpenAI/);
    assert.match(pia.accountLabel, /Space OpenCode/);
    assert.deepEqual([orin.why, pia.why], ["you asked", "you asked"]);
    assert.equal(orin.fellBackFrom, undefined, "no quiet swap to another model");
    assert.equal(pia.fellBackFrom, undefined);

    // the turns themselves ran on those models (the row is not just a label)
    for (const [h, want] of [[orin, "gpt-6"], [pia, "glm-5.2"]] as const) {
      const turns = (await s.api("engine.turns.list", { threadId: h.id })).turns as Json[];
      assert.ok(turns.length > 0 && turns.every((t) => t.model === want), `${h.title} ran on ${want}: ${JSON.stringify(turns.map((t) => t.model))}`);
    }

    // what the strip says, from that one read
    assert.equal(modelsLine(members), "Compare quotes on GPT-6 (you asked), northwind.com on GLM 5.2 (you asked)");
    assert.equal(rowModel(orin), "GPT-6 · Irfad's OpenAI");
    assert.equal(rowModel(pia), "GLM 5.2 · Space OpenCode");
  } finally { await stop(s.d); }
});
