// An agent working for a person makes a Mine folder for them, puts a key in it and uses it in their turn (Mine is "you and the agents working for you"). Real chats on a booted Personal daemon (the owner's key
// is held on the node, as on their own device); only the model is scripted. Another person, and another person's turn through the same agent, are covered in modules/vault/tests/agent-made.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../host/src/daemon/config.ts";
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

const SECRET = "fth_mine_FAKEsecretVALUE0123456789abcdef"; // secret-scan: fake

test("an agent makes a Mine folder for its person, puts a key in it and uses it; the key is theirs, in Mine, with nothing written for the agent on it", async () => {
  const model = scriptedModel(async function* (input, run) {
    if (!/make my own folder/.test(input.trigger?.body ?? "")) return;
    yield* run("tool_search", { query: "vault folders create" });
    yield* run("tool_search", { query: "vault item put" });
    const f = yield* run("vault_folders_create", { name: "My keys", scope: "mine", idempotencyKey: "mm-f" });
    const fid = (f.content as { data?: { folder?: { id?: string } } } | null)?.data?.folder?.id ?? "";
    if (!f.ok || !fid) return yield { type: "text", text: `FAILED folder ${JSON.stringify(f.content).slice(0, 300)}` };
    const p = yield* run("vault_item_put", {
      folderId: fid,
      name: "Mine key",
      kind: "api_key",
      fields: [{ key: "api_key", value: SECRET, secret: true }],
      idempotencyKey: "mm-i",
    });
    if (!p.ok) return yield { type: "text", text: `FAILED put ${JSON.stringify(p.content).slice(0, 300)}` };
    const found = yield* run("tool_search", { query: "vault use" });
    const u = found.ok ? yield* run("vault_use", { item: "Mine key", purpose: "Read the meetings" }) : found;
    yield { type: "text", text: u.ok ? "USED fine" : `FAILED use ${JSON.stringify(u.content).slice(0, 300)}` };
  });
  const dir = seededDir();
  const d = await boot(dir, model, {
    vault: undefined,
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space-kind", "personal"], {}, "1.2.3"),
  });
  try {
    await connect(d);
    const agentId = await makeAgent(d, "Ops");
    const thread = await startChat(d, agentId, "mm1");
    await ok(d, "chat.post", {
      threadId: thread,
      body: "make my own folder",
      mentions: [{ kind: "agent", id: agentId }],
      idempotencyKey: "mm1-post",
    });
    const said = await waitFor(
      async () => {
        await d.hooks?.pump?.();
        const ms = (await ok(d, "chat.messages.list", { threadId: thread })).messages as Array<{
          author?: { kind?: string };
          body?: string;
        }>;
        return ms.find((m) => m.author?.kind === "agent" && /^(USED|FAILED)/.test(m.body ?? "")) ?? null;
      },
      60_000,
      () => hostLog(d),
    );
    assert.match(said.body ?? "", /^USED/, said.body ?? "");
    const item = (await ok(d, "vault.items.list", { q: "Mine key" })).items.find(
      (i: { name: string }) => i.name === "Mine key",
    );
    assert.equal(item.scope, "mine");
    type Shares = Array<{ grant: { subject: { kind: string }; resource: { id: string }; source?: string } }>;
    const madeBy = (shares: Shares, id: string) =>
      shares.filter((x) => x.grant.resource.id === id && x.grant.source?.startsWith("made-by:"));
    const onItem = (await ok(d, "access.shares_of", { resource: { type: "vault_item", id: item.id } }))
      .shares as Shares;
    assert.deepEqual(madeBy(onItem, item.id), [], "nothing is written for the agent on a key in Mine");
    const onFolder = (await ok(d, "access.shares_of", { resource: { type: "vault_folder", id: item.folderId } }))
      .shares as Shares;
    assert.equal(
      madeBy(onFolder, item.folderId).length,
      1,
      "the Mine folder carries the maker's Edit, so it could put the key in",
    );
    assert.ok(!hostLog(d).includes(SECRET), "the value never reached the log");
    void call;
  } catch (e) {
    console.error("FAILED:", e instanceof Error ? e.message.slice(0, 1500) : e);
    throw e;
  } finally {
    await stop(d);
  }
});
