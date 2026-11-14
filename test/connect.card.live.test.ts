// The connect card on a booted daemon (finding F38, 14 Nov 2026): an agent is asked "is Fathom connected?", names the service in one call, and the person gets one card. Real chats, the real Vault, the real connectors
// module and the real capability pipeline; only the model is scripted and the outside network (the app's API) is a stand-in port that refuses a key that starts with "bad". The typed key reaches the app and the Vault and nothing else.
//   Personal: the owner of a one-person Space. The key is tried first, then kept in Mine, then connected, and the agent's first vault_use on it succeeds.
//   Team: a member (Mia) is asked to ask an admin (Olivia), who connects it from her own card; Mia's card finishes by itself and her agent carries on. A wrong key keeps nothing.
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import assert from "node:assert/strict";
import { CORE_SPACE } from "../fixtures/seed/core/index.ts";
import {
  KEY,
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
import type { Daemon } from "../host/src/daemon/daemon.ts";

const SECRET = "fth_card_FAKEsecretVALUE0123456789abcdef"; // secret-scan: fake
const WHO = ["usr_olivia", "usr_adam", "usr_mia", "usr_noah"];
const BANNED = /handle|clearance|restricted|your role|folder/i;

/** The app's API as a stand-in: a key that starts with "bad" is refused, anything else is accepted. It writes down every key that reached it. */
const network = (seen: string[]) => ({
  resolve: async () => ["93.184.216.34"],
  request: async (_url: URL, o: { headers: Record<string, string> }) => {
    const key = Object.entries(o.headers).find(([k]) => k.toLowerCase() === "x-api-key")?.[1] ?? "";
    seen.push(key);
    return key.startsWith("bad") ? { status: 401, text: "{}" } : { status: 200, text: '{"items":[]}' };
  },
});

async function defineFathom(
  d: Daemon,
  who: (cap: string, input: unknown) => Promise<{ status: number; data: any }>,
): Promise<void> {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(
    (
      await who("connectors.init", {
        key: "fathom",
        title: "Fathom",
        mode: "api",
        source: false,
        idempotencyKey: "cn-init",
      })
    ).status,
    200,
  );
  const def = await who("connectors.define", {
    key: "fathom",
    title: "Fathom",
    domains: ["api.fathom.test"],
    auth: { type: "api_key", header: "X-Api-Key", prefix: "", secret: "api_key" },
    secrets: [
      { name: "api_key", description: "Your Fathom API key" },
      { name: "webhook_secret", description: "Optional: the secret Fathom signs its webhooks with" },
    ],
    actions: [{ name: "list_meetings", method: "GET", url: "https://api.fathom.test/external/v1/meetings" }],
    idempotencyKey: "cn-def",
  });
  assert.equal(def.status, 200, JSON.stringify(def.data));
  const pub = await who("connectors.publish", { key: "fathom", idempotencyKey: "cn-pub" });
  assert.equal(pub.data.published, true, JSON.stringify(pub.data));
  void d;
}

const cardBlock = async (
  d: Daemon,
  who: (cap: string, input: unknown) => Promise<{ status: number; data: any }>,
  threadId: string,
) => {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  return waitFor(
    async () => {
      await d.hooks?.pump?.();
      const ms = (await who("chat.messages.list", { threadId })).data.messages as Array<{
        blocks: Array<{ type: string; data: { requestId?: string; service?: string } }>;
      }>;
      return ms?.flatMap((m) => m.blocks).find((b) => b.type === "vault_request") ?? null;
    },
    60_000,
    () => hostLog(d),
  );
};
const agentSaid = async (
  d: Daemon,
  who: (cap: string, input: unknown) => Promise<{ status: number; data: any }>,
  threadId: string,
  re: RegExp,
) => {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  return waitFor(
    async () => {
      await d.hooks?.pump?.();
      const ms = (await who("chat.messages.list", { threadId })).data.messages as Array<{
        author?: { kind?: string };
        body?: string;
      }>;
      return ms?.find((m) => m.author?.kind === "agent" && re.test(m.body ?? "")) ?? null;
    },
    60_000,
    () => hostLog(d),
  );
};
/** Every row of every table of a database, as one string: the typed key must be in none of them. */
const dump = (file: string): string => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    return tables.map((t) => JSON.stringify(db.prepare(`SELECT * FROM "${t.name}"`).all())).join("\n");
  } finally {
    db.close();
  }
};
const realFetch = globalThis.fetch;
const answerVendor = (): void => {
  // memory reads the account's model list once, which asks the vendor with the key: answer that here
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) =>
    String(url) === "https://api.anthropic.com/v1/models"
      ? Promise.resolve(
          new Response(JSON.stringify({ data: [{ id: "claude-haiku-4-5" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        )
      : realFetch(url, init)) as typeof fetch;
};

test("Personal: the owner asks for Fathom, one card tries the key, keeps it in Mine, connects it, and the agent's first vault_use works", async () => {
  answerVendor();
  const seen: string[] = [];
  const told: string[] = [];
  let step = 0;
  const model = scriptedModel(async function* (input, run) {
    const ask = input.trigger?.body ?? "";
    if (/is fathom connected/.test(ask)) {
      const r = yield* run("vault_connect", { service: "Fathom", idempotencyKey: `pc-${++step}` });
      told.push(JSON.stringify(r.content));
      yield {
        type: "text",
        text: r.ok ? "Not yet. Add its key and I'll connect it." : `FAILED ${JSON.stringify(r.content).slice(0, 300)}`,
      };
    } else if (/Carry on/.test(ask)) {
      yield { type: "text", text: "Yes, Fathom is connected." };
    } else if (/use fathom/.test(ask)) {
      const r = yield* run("vault_use", { item: "Fathom", purpose: "Read the meetings" });
      told.push(JSON.stringify(r.content));
      yield { type: "text", text: r.ok ? "Used it." : `FAILED ${JSON.stringify(r.content).slice(0, 300)}` };
    }
  });
  const dir = seededDir();
  const d = await boot(dir, model, { vault: undefined, connectorNetwork: network(seen) });
  try {
    await connect(d);
    await defineFathom(d, (cap, input) => call(d, cap, input));
    const agentId = await makeAgent(d, "Dex");
    const thread = await startChat(d, agentId, "pc-chat");
    await ok(d, "chat.post", {
      threadId: thread,
      body: "is fathom connected?",
      mentions: [{ kind: "agent", id: agentId }],
      idempotencyKey: "pc-post",
    });
    const block = await cardBlock(d, (cap, input) => call(d, cap, input), thread);
    assert.equal(block.data.service, "fathom", "the card is for the service, not for a key by name");
    const requestId = block.data.requestId as string;
    await agentSaid(d, (cap, input) => call(d, cap, input), thread, /Not yet\./);
    assert.equal(BANNED.test(told[0] ?? ""), false, `what the model was told: ${told[0]}`);

    const first = (await ok(d, "vault.connect_card.get", { requestId })).card;
    assert.equal(first.state, "ask");
    assert.deepEqual(
      first.fields.map((f: { name: string }) => f.name),
      ["api_key", "webhook_secret"],
    );
    const itemsBefore = ((await ok(d, "vault.items.list", {})).items as unknown[]).length;

    // a wrong key: tried first, refused, nothing kept, nothing connected
    const wrong = await ok(d, "vault.connect_card.submit", {
      requestId,
      fields: [{ key: "api_key", value: "bad-key-0001" }],
    });
    assert.equal(wrong.result, "wrong");
    assert.equal(wrong.card.state, "wrong");
    assert.equal(((await ok(d, "vault.items.list", {})).items as unknown[]).length, itemsBefore, "nothing was kept");
    assert.equal(((await ok(d, "connections.list", { connector: "fathom" })).connections as unknown[]).length, 0);

    // the right key
    const good = await ok(d, "vault.connect_card.submit", { requestId, fields: [{ key: "api_key", value: SECRET }] });
    assert.equal(good.result, "connected");
    assert.equal(good.card.state, "connected");
    assert.equal(good.card.keptIn, "Mine");
    const conns = (await ok(d, "connections.list", { connector: "fathom" })).connections as Array<{ state: string }>;
    assert.deepEqual(
      conns.map((c) => c.state),
      ["active"],
    );
    await agentSaid(d, (cap, input) => call(d, cap, input), thread, /Yes, Fathom is connected\./);

    // the key ends where the agent can use it: its first vault_use succeeds
    await ok(d, "chat.post", {
      threadId: thread,
      body: "use fathom",
      mentions: [{ kind: "agent", id: agentId }],
      idempotencyKey: "pc-use",
    });
    await agentSaid(d, (cap, input) => call(d, cap, input), thread, /Used it\./);

    // the same card, not a second one, and no "Withdrawn" anywhere
    const all = JSON.stringify((await ok(d, "chat.messages.list", { threadId: thread })).messages);
    assert.equal((all.match(/"type":"vault_request"/g) ?? []).length, 1, "one card");
    assert.ok(!/Withdrawn/.test(all));
    assert.ok(!all.includes(SECRET) && !hostLog(d).includes(SECRET), "the key is in no message, block or log line");
    assert.ok(seen.includes(SECRET) && seen.includes("bad-key-0001"), "the key reached the app, and only the app");
    // the value scan: the typed key is in no log row, event or table of the Space (the request row is one of them)
    d.sink.flush();
    assert.equal(dump(d.paths.logs).includes(SECRET), false, "not in logs.db");
    assert.equal(dump(path.join(dir, "events.db")).includes(SECRET), false, "not in the events or any module table");
  } catch (e) {
    console.error("FAILED:", e instanceof Error ? e.message.slice(0, 1500) : e);
    throw e;
  } finally {
    globalThis.fetch = realFetch;
    await stop(d);
  }
});

test("Team: a member is sent to an admin by name, the admin connects it from her own card, the member's card finishes by itself and her agent carries on", async () => {
  answerVendor();
  const seen: string[] = [];
  const told: string[] = [];
  let step = 0;
  const model = scriptedModel(async function* (input, run) {
    const ask = input.trigger?.body ?? "";
    if (/is fathom connected/.test(ask)) {
      const r = yield* run("vault_connect", { service: "Fathom", idempotencyKey: `tc-${++step}` });
      told.push(JSON.stringify(r.content));
      yield {
        type: "text",
        text: r.ok ? "Not yet. An admin can connect it." : `FAILED ${JSON.stringify(r.content).slice(0, 300)}`,
      };
    } else if (/Carry on/.test(ask)) {
      yield { type: "text", text: "Yes, Fathom is connected." };
    } else if (/use fathom/.test(ask)) {
      const r = yield* run("vault_use", { item: "Fathom", purpose: "Read the meetings" });
      told.push(JSON.stringify(r.content));
      yield { type: "text", text: r.ok ? "Used it." : `FAILED ${JSON.stringify(r.content).slice(0, 300)}` };
    }
  });
  const ownerToken = { v: "" };
  const d = await boot(seededDir(), model, {
    vault: undefined,
    connectorNetwork: network(seen),
    session: (headers: Record<string, string | undefined>) => {
      const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
      const id = t === ownerToken.v ? "usr_olivia" : t;
      return WHO.includes(id)
        ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "connect-team" }
        : null;
    },
  });
  ownerToken.v = d.token;
  const as =
    (who: string) =>
    async (cap: string, input: unknown): Promise<{ status: number; data: any }> => {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${who}` },
        body: JSON.stringify(input),
      });
      const b = (await r.json()) as { data?: unknown };
      return { status: r.status, data: (b.data ?? b) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
  const olivia = as("usr_olivia");
  const mia = as("usr_mia");
  try {
    await connect(d);
    const agentId = (
      await olivia("agents.create", { name: "Ops", role: "You help the team.", idempotencyKey: "tc-agent" })
    ).data.agent.agentId as string;
    const ai = await olivia("vault.folders.create", { idempotencyKey: "tc-ai", name: "AI accounts", scope: "shared" });
    const acct = await olivia("providers.add", {
      idempotencyKey: "tc-acct",
      providerKey: "anthropic",
      connection: "api_key",
      apiKey: `${KEY}A`,
      name: "Team AI",
      scope: "shared",
      folderId: ai.data.folder.id,
    });
    await olivia("agents.update", {
      agentId,
      patch: { accountPolicy: "key", accountKey: acct.data.provider.handle },
      idempotencyKey: "tc-upd",
    });
    await olivia("vault.folders.create", { idempotencyKey: "tc-team", name: "Team keys", scope: "shared" });
    await defineFathom(d, olivia);

    const th = await mia("chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "tc-chat" });
    const threadId = th.data.thread.threadId as string;
    await mia("chat.post", {
      threadId,
      body: "is fathom connected?",
      mentions: [{ kind: "agent", id: agentId }],
      idempotencyKey: "tc-post",
    });
    const block = await cardBlock(d, mia, threadId);
    const requestId = block.data.requestId as string;
    await agentSaid(d, mia, threadId, /Not yet\./);
    assert.equal(BANNED.test(told[0] ?? ""), false, `what the model was told: ${told[0]}`);

    // Mia may not connect services here: the card says so and offers the admin by name; she cannot type a key
    const hers = (await mia("vault.connect_card.get", { requestId })).data.card;
    assert.deepEqual([hers.state, hers.mayFill], ["admin", false]);
    assert.ok(hers.admin?.id, "an admin to ask, by id: the screen says the name");
    const refused = await mia("vault.connect_card.submit", { requestId, fields: [{ key: "api_key", value: SECRET }] });
    assert.ok(refused.status >= 400 && refused.status < 500, JSON.stringify(refused.data));
    assert.ok(!JSON.stringify(refused.data).includes(SECRET));
    assert.equal(seen.length, 0, "a key a person may not use never reached the app");

    // Ask: one task for the admin, Asked on the card with the time
    const asked = await mia("vault.connect_card.ask_admin", { requestId });
    assert.equal(asked.status, 200, JSON.stringify(asked.data));
    assert.equal(asked.data.card.state, "asked");
    assert.ok(asked.data.card.admin.askedAt > 0);
    const tasks = (await olivia("tasks.list", { scope: "all", kinds: ["unblock"], states: ["todo", "doing"] })).data
      .tasks as Array<{ title: string }>;
    assert.equal(tasks.filter((t) => t.title === "Connect Fathom").length, 1);

    // the admin connects it from her own card: a wrong key keeps nothing, the right one connects
    const theirs = (await olivia("vault.connect_card.get", { requestId })).data.card;
    assert.deepEqual([theirs.state, theirs.mayFill], ["ask", true]);
    const itemsBefore = ((await olivia("vault.items.list", {})).data.items as unknown[]).length;
    const wrong = await olivia("vault.connect_card.submit", {
      requestId,
      fields: [{ key: "api_key", value: "bad-admin-key" }],
    });
    assert.equal(wrong.data.result, "wrong");
    assert.equal(
      ((await olivia("vault.items.list", {})).data.items as unknown[]).length,
      itemsBefore,
      "nothing was kept",
    );
    const folder = (
      (await olivia("vault.connect_card.options", { requestId })).data.folders as Array<{
        name: string;
        usable: boolean;
      }>
    ).find((f) => f.name === "Team keys");
    assert.equal(folder?.usable, true, "a folder the agent can use is offered");
    const good = await olivia("vault.connect_card.submit", { requestId, fields: [{ key: "api_key", value: SECRET }] });
    assert.equal(good.data.result, "connected", JSON.stringify(good.data));
    assert.equal(
      (await mia("vault.connect_card.get", { requestId })).data.card.state,
      "connected",
      "Mia's card finishes by itself",
    );

    // her agent carries on in her chat, and its first use of the key works for her
    await agentSaid(d, mia, threadId, /Yes, Fathom is connected\./);
    await mia("chat.post", {
      threadId,
      body: "use fathom",
      mentions: [{ kind: "agent", id: agentId }],
      idempotencyKey: "tc-use",
    });
    await agentSaid(d, mia, threadId, /Used it\./);

    const all = JSON.stringify((await mia("chat.messages.list", { threadId })).data.messages) + hostLog(d);
    assert.ok(!all.includes(SECRET), "the key is in no message, block or log line");
    assert.ok(!/Withdrawn/.test(all));
  } catch (e) {
    console.error("FAILED:", e instanceof Error ? e.message.slice(0, 1500) : e);
    throw e;
  } finally {
    globalThis.fetch = realFetch;
    await stop(d);
  }
});
