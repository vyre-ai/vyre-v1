// A fresh install picks Model "Auto" and says hello (5 Nov 2026: this failed with provider.bad_request, `model` must be a non-empty string). End to end on a booted daemon with the real API driver: the
// vendor is a stand-in that answers an empty model name the way the real one did, and a good request with a reply. The account's list cannot be read (the vendor's list answers 500, "Couldn't refresh"),
// so Auto has only the pinned model to run on. The turn must reach the vendor with a concrete model name, the person must get the reply, and no 400 may ever be shown.
import test from "node:test";
import assert from "node:assert/strict";
import { claimedSpace, hostLog, stop, waitFor } from "./support/eco-live.ts";

type Json = any;   // eslint-disable-line @typescript-eslint/no-explicit-any

test("Auto on an API key whose model list cannot be refreshed: the hello gets a reply on the pinned model, and the vendor never sees an empty model", async () => {
  const asked: Array<string | undefined> = [];
  const sse = (text: string): Response => {
    const chunk = (d: unknown, finish: string | null = null) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: d, finish_reason: finish }] })}\n\n`;
    return new Response(chunk({ role: "assistant", content: text }) + chunk({}, "stop") + `data: ${JSON.stringify({ id: "c1", choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  };
  const vendor = (async (input: string | URL | Request, init?: RequestInit) => {
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
  const s = await claimedSpace(null as never, "Fresh Co", { engineOpenSession: undefined, engineCli: { apiFetch: vendor } as never, providerFetch: vendor });
  try {
    const mine = (await s.api("vault.folders.list", { scope: "mine" })).folders[0].id as string;
    const key = (await s.api("providers.add", { idempotencyKey: "am-key", providerKey: "openai", connection: "api_key", apiKey: "sk-live-TESTopenaiKEY0123456789", scope: "mine", folderId: mine })).provider;
    // a fresh agent, its chat on this account, the model left on Auto (nothing picked)
    const agent = (await s.api("agents.create", { name: "Hello", role: "You greet people.", idempotencyKey: "am-agent" })).agent.agentId as string;
    await s.api("agents.update", { agentId: agent, patch: { accountPolicy: "key", accountKey: key.handle }, idempotencyKey: "am-patch" });
    const chat = (await s.api("chat.start", { kind: "chat", agentIds: [agent], title: "Hello", idempotencyKey: "am-chat" })).thread.threadId as string;
    await s.api("chat.post", { threadId: chat, body: "hello", mentions: [{ kind: "agent", id: agent }], idempotencyKey: "am-hello" });
    const reply = await waitFor(async () => {
      await s.d.hooks?.pump?.();
      const ms = (await s.api("chat.messages.list", { threadId: chat })).messages as Json[];
      return ms.find((m) => m.author?.kind === "agent" && /Hello from /.test(m.body ?? "")) ?? null;
    }, 60_000, () => `${hostLog(s.d)} asked=${JSON.stringify(asked)}`);
    assert.match(reply.body, /^Hello from gpt-5\./, "the pinned OpenAI model ran it");
    assert.ok(asked.length > 0 && asked.every((m) => typeof m === "string" && m !== ""), `the vendor never saw an empty model: ${JSON.stringify(asked)}`);
    const ms = (await s.api("chat.messages.list", { threadId: chat })).messages as Json[];
    const blocks = ms.flatMap((m) => m.blocks ?? []) as Json[];
    assert.equal(blocks.some((b) => b.type === "turn_status" && b.data?.state === "failed"), false, "no failed turn, no provider 400 on screen");
  } finally { await stop(s.d); }
});
