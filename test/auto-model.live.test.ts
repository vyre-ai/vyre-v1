// A fresh install picks Model "Auto" and says hello (5 Nov 2026: this failed with provider.bad_request, `model` must be a non-empty string). End to end on a booted daemon with the real API driver: the
// vendor is a stand-in that answers an empty model name the way the real one did, and a good request with a reply. The account's list cannot be read (the vendor's list answers 500, "Couldn't refresh"),
// so Auto has only the pinned model to run on (OpenCode Go has one in this release's catalog; OpenAI has none, so nothing is guessed). The turn must reach the vendor with a concrete model name and the
// person must get the reply; where nothing can be chosen the person is asked to pick a model, before any request, and no provider 400 is ever shown.
import test from "node:test";
import assert from "node:assert/strict";
import { claimedSpace, hostLog, stop, waitFor } from "./support/eco-live.ts";
import { completerOf } from "../modules/engine/runtime.ts";

type Json = any;   // eslint-disable-line @typescript-eslint/no-explicit-any

const sse = (text: string): Response => {
  const chunk = (d: unknown, finish: string | null = null) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: d, finish_reason: finish }] })}\n\n`;
  return new Response(chunk({ role: "assistant", content: text }) + chunk({}, "stop") + `data: ${JSON.stringify({ id: "c1", choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
};

/** A vendor whose model list cannot be refreshed, and whose chat answers an empty model the way the real one did. */
function vendor(asked: Array<string | undefined>): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/models")) return new Response(JSON.stringify({ error: "refresh failed" }), { status: 500, headers: { "content-type": "application/json" } });
    if (url.endsWith("/chat/completions")) {
      const model = (JSON.parse(String(init?.body ?? "{}")) as { model?: string }).model;
      asked.push(model);
      if (typeof model !== "string" || model === "") return new Response(JSON.stringify({ message: "`model` must be a non-empty string", type: "invalid_request_error", param: "model" }), { status: 400, headers: { "content-type": "application/json" } });
      return sse(`Hello from ${model}.`);
    }
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

async function freshChat(s: Awaited<ReturnType<typeof claimedSpace>>, providerKey: string, label: string): Promise<{ chat: string; agent: string }> {
  const mine = (await s.api("vault.folders.list", { scope: "mine" })).folders[0].id as string;
  const key = (await s.api("providers.add", { idempotencyKey: `am-key-${label}`, providerKey, connection: "api_key", apiKey: "sk-live-TESTkeyKEY0123456789", scope: "mine", folderId: mine })).provider;
  // a fresh agent, its chat on this account, the model left on Auto (nothing picked)
  const agent = (await s.api("agents.create", { name: `Hello ${label}`, role: "You greet people.", idempotencyKey: `am-agent-${label}` })).agent.agentId as string;
  await s.api("agents.update", { agentId: agent, patch: { accountPolicy: "key", accountKey: key.handle }, idempotencyKey: `am-patch-${label}` });
  const chat = (await s.api("chat.start", { kind: "chat", agentIds: [agent], title: "Hello", idempotencyKey: `am-chat-${label}` })).thread.threadId as string;
  await s.api("chat.post", { threadId: chat, body: "hello", mentions: [{ kind: "agent", id: agent }], idempotencyKey: `am-hello-${label}` });
  return { chat, agent };
}

test("Auto on an OpenCode key whose model list cannot be refreshed: the hello gets a reply on the catalog's pinned model, and the vendor never sees an empty model", async () => {
  const asked: Array<string | undefined> = [];
  const v = vendor(asked);
  const s = await claimedSpace(null as never, "Fresh Co", { engineOpenSession: undefined, engineCli: { apiFetch: v } as never, providerFetch: v });
  try {
    const { chat } = await freshChat(s, "opencode-go", "oc");
    const reply = await waitFor(async () => {
      await s.d.hooks?.pump?.();
      const ms = (await s.api("chat.messages.list", { threadId: chat })).messages as Json[];
      return ms.find((m) => m.author?.kind === "agent" && /Hello from /.test(m.body ?? "")) ?? null;
    }, 60_000, () => `${hostLog(s.d)} asked=${JSON.stringify(asked)}`);
    assert.match(reply.body, /^Hello from glm-5\.3\./, "the pinned OpenCode Go model ran it");
    assert.ok(asked.length > 0 && asked.every((m) => typeof m === "string" && m !== ""), `the vendor never saw an empty model: ${JSON.stringify(asked)}`);
    const blocks = ((await s.api("chat.messages.list", { threadId: chat })).messages as Json[]).flatMap((m) => m.blocks ?? []) as Json[];
    assert.equal(blocks.some((b) => b.type === "turn_status" && b.data?.state === "failed"), false, "no failed turn, no provider 400 on screen");
  } finally { await stop(s.d); }
});

test("Auto on an OpenAI key whose list cannot be read: nothing is guessed, the chat says Pick a model for the account, and no request is ever sent", async () => {
  const asked: Array<string | undefined> = [];
  const v = vendor(asked);
  const s = await claimedSpace(null as never, "Fresh Co", { engineOpenSession: undefined, engineCli: { apiFetch: v } as never, providerFetch: v });
  try {
    const { chat } = await freshChat(s, "openai", "oa");
    const failed = await waitFor(async () => {
      await s.d.hooks?.pump?.();
      const ms = (await s.api("chat.messages.list", { threadId: chat })).messages as Json[];
      return (ms.flatMap((m) => m.blocks ?? []) as Json[]).find((b) => b.type === "turn_status" && b.data?.state === "failed") ?? null;
    }, 60_000, () => `${hostLog(s.d)} asked=${JSON.stringify(asked)}`);
    assert.equal(failed.data.code, "engine.no_model_picked");
    assert.match(String(failed.data.detail), /^Pick a model for .+\.$/);
    assert.deepEqual(asked, [], "nothing reached the vendor: the person never sees its 400");
  } finally { await stop(s.d); }
});

test("a one-shot on Auto (what memory capture and the room digest use, engine.complete) gets the same concrete model as a turn: unset on an OpenCode key it runs on the catalog's model, never an empty one", async () => {
  const asked: Array<string | undefined> = [];
  const v = vendor(asked);
  const s = await claimedSpace(null as never, "Fresh Co", { engineOpenSession: undefined, engineCli: { apiFetch: v } as never, providerFetch: v });
  try {
    const mine = (await s.api("vault.folders.list", { scope: "mine" })).folders[0].id as string;
    const key = (await s.api("providers.add", { idempotencyKey: "am-key-os", providerKey: "opencode-go", connection: "api_key", apiKey: "sk-live-TESTkeyKEY0123456789", scope: "mine", folderId: mine })).provider;
    // the one-shot path itself, as memory upkeep and the room digest call it (the daemon runs in this process, so its completer is the real one)
    const owner = (await s.api("identity.whoami", {})).principal.id as string;
    const account = { ref: key.handle, name: "Irfad's OpenCode", driver: "opencode_go", provider: "opencode-go", kind: "api_key", payer: owner, reason: "starter" } as never;
    const run = completerOf();
    assert.ok(run, "the engine's completer exists");
    const complete = async (extra: Record<string, unknown>): Promise<string> => (await run({ account, prompt: "Say hello.", ...extra })).text;
    assert.match(await complete({}), /^Hello from glm-5\.3\./);
    // the same call with the word Auto, and with a model the person picked
    assert.match(await complete({ model: "auto" }), /^Hello from glm-5\.3\./);
    assert.match(await complete({ model: "deepseek-v4.1-flash" }), /^Hello from deepseek-v4\.1-flash\./);
    assert.ok(asked.length === 3 && asked.every((m) => typeof m === "string" && m !== ""), `the vendor never saw an empty model: ${JSON.stringify(asked)}`);
  } finally { await stop(s.d); }
});
