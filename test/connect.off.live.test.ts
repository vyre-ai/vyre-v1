// The connect card is OFF by default (lib/connect-switch.ts, rc.28; review r-keyreach-9-b-connect). On a booted daemon with the switch off, an agent that needs a key for a service that HAS a built-in connector (Fathom)
// calls vault_request on its first call, with no tool_search before it, and the person gets the plain key request card: a vault_request block with no service in it, the ordinary "Fathom key needed" row. No connect
// card is made; every connect capability answers the one plain refusal, for the person and for the agent's own vault_connect call. This file never turns the switch on.
import test from "node:test";
import assert from "node:assert/strict";
import {
  boot,
  call,
  connect,
  hostLog,
  makeAgent,
  ok,
  scriptedModel,
  seededDir,
  startChat,
  stop,
  waitFor,
} from "./support/eco-live.ts";
import { CONNECT_OFF_MESSAGE, connectCardOn } from "../lib/connect-switch.ts";

test("with the switch off, an agent asking for a Fathom key gets the plain key request card and no connect card", async () => {
  assert.equal(connectCardOn(), false);
  const seen: string[] = [];
  const model = scriptedModel(async function* (input, run) {
    const ask = input.trigger?.body ?? "";
    if (/set up fathom/.test(ask)) {
      // the first call is vault_request itself: it is in the default listed set (no tool_search)
      const r = yield* run("vault_request", {
        name: "Fathom",
        fields: ["api_key"],
        reason: "To read your meetings.",
        idempotencyKey: "off-fathom",
      });
      seen.push(`request:${r.ok}`);
      // and the connect tool, called by name, is not an offered tool: the tool layer refuses it before the server is asked (it was never found with tool_search), so no card is made
      const c = yield* run("vault_connect", { service: "Fathom", idempotencyKey: "off-connect" });
      seen.push(`connect:${c.ok}`);
      yield {
        type: "text",
        text: r.ok ? "I asked for the Fathom key." : `FAILED ${JSON.stringify(r.content).slice(0, 200)}`,
      };
    }
  });
  const d = await boot(seededDir(), model, { vault: undefined });
  try {
    await connect(d);
    const agentId = await makeAgent(d, "Ops");
    const thread = await startChat(d, agentId, "off1");
    await ok(d, "chat.post", {
      threadId: thread,
      body: "set up fathom",
      mentions: [{ kind: "agent", id: agentId }],
      idempotencyKey: "off1-post",
    });
    const card = await waitFor(
      async () => {
        await d.hooks?.pump?.();
        const ms = (await ok(d, "chat.messages.list", { threadId: thread })).messages as Array<{
          blocks: Array<{ type: string; data: { requestId?: string; service?: string } }>;
        }>;
        return ms.flatMap((m) => m.blocks).find((b) => b.type === "vault_request") ?? null;
      },
      40_000,
      () => hostLog(d),
    );
    assert.match(card.data.requestId as string, /^vrq_/);
    assert.equal(card.data.service, undefined, "the plain key request card: the block names no service");
    const open = (await ok(d, "tasks.list", { scope: "all", kinds: ["unblock"], states: ["todo", "doing"] }))
      .tasks as Array<{ title: string }>;
    assert.ok(
      open.some((t) => t.title === "Fathom key needed"),
      JSON.stringify(open.map((t) => t.title)),
    );
    // no connect card: the one block that came is the plain one, and the card's own reads and writes are refused for the person too
    const ms = (await ok(d, "chat.messages.list", { threadId: thread })).messages as Array<{
      blocks: Array<{ type: string }>;
    }>;
    assert.equal(ms.flatMap((m) => m.blocks).filter((b) => b.type === "vault_request").length, 1);
    for (const [cap, input] of [
      ["vault.connect", { service: "Fathom", idempotencyKey: "off-person-connect" }],
      ["vault.connect_card.get", { requestId: card.data.requestId }],
      ["vault.connect_card.submit", { requestId: card.data.requestId, useSaved: true }],
      ["connectors.for_service", { service: "Fathom" }],
    ] as const) {
      const r = await call(d, cap, input);
      assert.notEqual(r.status, 200, cap);
      assert.ok(JSON.stringify(r.data).includes(CONNECT_OFF_MESSAGE), `${cap}: ${JSON.stringify(r.data)}`);
    }
    await waitFor(
      async () => (seen.some((s) => s.startsWith("connect:")) ? true : null),
      40_000,
      () => hostLog(d),
    );
    assert.deepEqual(seen, ["request:true", "connect:false"]);
  } catch (e) {
    console.error("FAILED:", e instanceof Error ? e.message.slice(0, 1500) : e);
    throw e;
  } finally {
    await stop(d);
  }
});
