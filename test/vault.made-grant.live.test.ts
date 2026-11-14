// What an agent makes in the Vault for the person it works for is that person's, and that agent can use it at once (owner ruling, 14 Nov 2026), with no help from anything else: the same call records an
// explicit grant to the agent on that one folder (Edit) and key (Use), made by the person and shown as made by the agent. No other agent is named on it.
// Real chats on a booted Team daemon; only the model is scripted.
import test from "node:test";
import assert from "node:assert/strict";
import { CORE_SPACE } from "../fixtures/seed/core/index.ts";
import { KEY, boot, connect, hostLog, scriptedModel, seededDir, stop, waitFor } from "./support/eco-live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const SECRET = "fth_made_FAKEsecretVALUE0123456789abcdef"; // secret-scan: fake
const WHO = ["usr_olivia", "usr_adam", "usr_mia", "usr_noah"];

const as =
  (d: Daemon) =>
  async (who: string, cap: string, input: unknown): Promise<{ status: number; data: any }> => {
    // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${who}` },
      body: JSON.stringify(input),
    });
    const b = (await r.json()) as { data?: unknown };
    return { status: r.status, data: b.data ?? b };
  };

test("an agent makes a shared folder and a key for its person and uses it; it holds an explicit grant made by the person, which she can remove", async () => {
  const made = { folderId: "" };
  const model = scriptedModel(async function* (input, run) {
    const ask = input.trigger?.body ?? "";
    if (/make the key folder/.test(ask)) {
      yield* run("tool_search", { query: "vault folders create" });
      yield* run("tool_search", { query: "vault item put" });
      const f = yield* run("vault_folders_create", { name: "Fathom keys", scope: "shared", idempotencyKey: "am-f" });
      const fid = (f.content as { data?: { folder?: { id?: string } } } | null)?.data?.folder?.id ?? "";
      if (!f.ok || !fid)
        return yield { type: "text", text: `FAILED folder ${JSON.stringify(f.content).slice(0, 300)}` };
      made.folderId = fid;
      const p = yield* run("vault_item_put", {
        folderId: fid,
        name: "Fathom",
        kind: "api_key",
        fields: [{ key: "api_key", value: SECRET, secret: true }],
        idempotencyKey: "am-i",
      });
      if (!p.ok) return yield { type: "text", text: `FAILED put ${JSON.stringify(p.content).slice(0, 300)}` };
      const found = yield* run("tool_search", { query: "vault use" });
      const u = found.ok ? yield* run("vault_use", { item: "Fathom", purpose: "Read the meetings" }) : found;
      yield { type: "text", text: u.ok ? "USED fine" : `FAILED use ${JSON.stringify(u.content).slice(0, 300)}` };
    }
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) =>
    String(url) === "https://api.anthropic.com/v1/models"
      ? Promise.resolve(
          new Response(JSON.stringify({ data: [{ id: "claude-haiku-4-5" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        )
      : realFetch(url, init)) as typeof fetch;
  const ownerToken = { v: "" };
  const d = await boot(seededDir(), model, {
    vault: undefined,
    session: (headers: Record<string, string | undefined>) => {
      const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
      const id = t === ownerToken.v ? "usr_olivia" : t;
      return WHO.includes(id)
        ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "made-team" }
        : null;
    },
  });
  ownerToken.v = d.token;
  const api = as(d);
  const say = async (who: string, threadId: string) => {
    const ms = (await api(who, "chat.messages.list", { threadId })).data.messages as Array<{
      author?: { kind?: string };
      body?: string;
    }>;
    return ms.find((m) => m.author?.kind === "agent" && /^(USED|FAILED|REFUSED)/.test(m.body ?? "")) ?? null;
  };
  try {
    await connect(d);
    const ai = await api("usr_olivia", "vault.folders.create", {
      idempotencyKey: "am-ai",
      name: "AI accounts",
      scope: "shared",
    });
    const acct = await api("usr_olivia", "providers.add", {
      idempotencyKey: "am-acct",
      providerKey: "anthropic",
      connection: "api_key",
      apiKey: `${KEY}A`,
      name: "Team AI",
      scope: "shared",
      folderId: ai.data.folder.id,
    });
    const agent = async (name: string): Promise<string> => {
      const id = (await api("usr_olivia", "agents.create", { name, role: "You help.", idempotencyKey: `am-${name}` }))
        .data.agent.agentId as string;
      await api("usr_olivia", "agents.update", {
        agentId: id,
        patch: { accountPolicy: "key", accountKey: acct.data.provider.handle },
        idempotencyKey: `am-upd-${name}`,
      });
      return id;
    };
    const maker = await agent("Maker");
    const chat = async (who: string, agentId: string, body: string, key: string): Promise<string> => {
      const th = await api(who, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: `${key}-c` });
      const threadId = th.data.thread.threadId as string;
      await api(who, "chat.post", {
        threadId,
        body,
        mentions: [{ kind: "agent", id: agentId }],
        idempotencyKey: `${key}-p`,
      });
      return threadId;
    };
    const wait = async (who: string, threadId: string) =>
      waitFor(
        async () => {
          await d.hooks?.pump?.();
          return await say(who, threadId);
        },
        60_000,
        () => hostLog(d),
      );

    // Maker, working for Mia, makes a shared folder and a key and uses it, with nothing but its own call
    const t1 = await chat("usr_mia", maker, "make the key folder", "am1");
    const said = await wait("usr_mia", t1);
    assert.match(said.body ?? "", /^USED/, said.body ?? "");
    const folder = (await api("usr_mia", "vault.folders.list", { scope: "shared" })).data.folders.find(
      (f: { name: string }) => f.name === "Fathom keys",
    );
    assert.equal(folder.owner, "usr_mia", "the person owns what the agent made for them");
    const item = (await api("usr_mia", "vault.items.list", { q: "Fathom" })).data.items.find(
      (i: { name: string }) => i.name === "Fathom",
    );
    assert.equal(item.owner, "usr_mia");
    // the explicit grants are the person's, show who made them, and she can take them away
    const shares = (await api("usr_mia", "access.shares_of", { resource: { type: "vault_folder", id: folder.id } }))
      .data.shares as Array<{
      grant: {
        id: string;
        subject: { id: string };
        resource: { id: string };
        level: string;
        source?: string;
        by: string;
      };
    }>;
    const g = shares.find((s) => s.grant.subject.id === maker && s.grant.resource.id === folder.id);
    assert.ok(g, JSON.stringify(shares));
    assert.equal(g!.grant.level, "edit");
    assert.equal(g!.grant.by, "usr_mia");
    assert.ok(
      !shares.some(
        (s) => s.grant.resource.id === folder.id && s.grant.subject.kind === "agent" && s.grant.subject.id !== maker,
      ),
      "no other agent",
    );

    // the key too carries a Use grant for the maker alone; no other agent is named on anything the maker made
    const kshares = (await api("usr_mia", "access.shares_of", { resource: { type: "vault_item", id: item.id } })).data
      .shares as Array<{
      grant: { subject: { id: string }; resource: { id: string }; level: string; source?: string };
    }>;
    const kg = kshares.find((s) => s.grant.subject.id === maker && s.grant.resource.id === item.id);
    assert.equal(kg?.grant.level, "use");
    assert.equal(kg?.grant.source, `made-by:${maker}`);
    assert.ok(
      !kshares.some(
        (s) => s.grant.resource.id === item.id && s.grant.subject.id !== maker && s.grant.subject.kind === "agent",
      ),
    );
    // she can take it away like any grant (the shares list shows it, the grant is hers)
    const gone = await api("usr_mia", "access.unshare", {
      resource: { type: "vault_item", id: item.id },
      subject: { kind: "agent", id: maker },
    });
    assert.equal(gone.status, 200, JSON.stringify(gone.data));
    // NOTE: every agent of a Team Space also holds Edit on the Space itself (a seeded grant of its birth), so a second agent reaches shared things through that, whatever the maker was given here.
    assert.ok(!hostLog(d).includes(SECRET), "the value never reached the log");
  } catch (e) {
    console.error("FAILED:", e instanceof Error ? e.message.slice(0, 1500) : e);
    throw e;
  } finally {
    globalThis.fetch = realFetch;
    await stop(d);
  }
});
