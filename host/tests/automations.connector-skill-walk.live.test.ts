// The connector build as the connector-builder skill tells an agent to do it, played by this test in the skill's own order (no model): the test reads agent/skills/connector-builder/SKILL.md, takes
// the tools its Steps name in order, and calls each one as the agent through the real daemon against a stand-in app (docs page and API answered by the network stub). A change to the skill that
// reorders or drops a step this walk depends on fails here. The person's side (answers, Always allow, Publish) is played where the skill says the agent waits for them.
// Checked on the way: the key's value is in no reply, no card and no event; the first test read waits for the person; after their Always allow it passes; the connector ends live and bound.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { DaemonOptions } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve('{"apps":{"http":{}}}'),
  });
const OWNER = "tok-usr_olivia";
const AGENT = "tok-agent";
const SECRET = "fake_notely_skill_58";
const SKILL = fileURLToPath(new URL("../../agent/skills/connector-builder/SKILL.md", import.meta.url));
const DOCS = `<html><body><h1>Notely API</h1><p>Base URL: https://api.notely.example. Send your key in the X-Api-Key header.</p>
<h2>GET /v1/notes</h2><p>List notes.</p><h2>POST /v1/notes</h2><p>Create a note.</p></body></html>`;

/** The step number each tool belongs to on the build path: step 1 (Check first) for its own two checks, else the first numbered step after it that names the tool. */
function skillSteps(): Map<string, number> {
  const text = fs.readFileSync(SKILL, "utf8");
  const steps = text.slice(text.indexOf("## Steps"), text.indexOf("## When it fails"));
  const out = new Map<string, number>();
  for (const block of steps.split(/\n(?=\d+\. )/)) {
    const n = Number(/^(\d+)\. /.exec(block)?.[1] ?? NaN);
    if (!Number.isFinite(n)) continue;
    const tools = [...block.matchAll(/`([a-z]+_[a-z_]+)`/g)].map((m) => m[1]!);
    for (const t of n === 1 ? tools.slice(0, 2) : tools)
      if (!out.has(t) || (out.get(t) === 1 && n > 1 && !["vault_use", "connectors_list"].includes(t))) out.set(t, n);
  }
  return out;
}

test("the connector build in the skill's order, as the agent, against a stand-in app", async () => {
  const step = skillSteps();
  // the build path this walk plays, in the skill's step order; a skill that drops one of these or moves it before an earlier one fails here
  const needed = [
    "vault_use",
    "connectors_list",
    "automations_read_docs",
    "ask_question",
    "connectors_init",
    "connectors_define",
    "automations_try_read",
    "automations_connector_card",
    "connectors_publish",
    "connections_create",
  ];
  let at = 0;
  for (const t of needed) {
    const n = step.get(t);
    assert.ok(
      n !== undefined && n >= at,
      `the skill's step for ${t} (${String(n)}) comes after the steps before it: ${JSON.stringify([...step])}`,
    );
    at = n!;
  }

  const dialled: { host: string; key: boolean }[] = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-skill-walk-"));
  const core = bootCore();
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux",
      hostname: "skill-walk",
      free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    seams: {
      vaultSinks: { env: () => undefined },
      fetch: async () => {
        throw new Error("the pinned network is used");
      },
      drivers: {
        setDocumentNetwork: () => ({
          lookup: async () => ["93.184.216.34"],
          fetch: async () => {
            throw new Error("the pinned connect is used");
          },
          connect: async (r: { url: URL; headers?: Readonly<Record<string, string>> }) => {
            dialled.push({ host: r.url.hostname, key: Object.values(r.headers ?? {}).some((v) => v.includes(SECRET)) });
            if (r.url.hostname === "docs.notely.example")
              return new Response(DOCS, { status: 200, headers: { "content-type": "text/html" } });
            if (r.url.hostname === "api.notely.example" && r.url.pathname === "/v1/notes")
              return new Response('{"notes":[]}', { status: 200, headers: { "content-type": "application/json" } });
            return new Response("not found", { status: 404 });
          },
        }),
      },
    },
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      if (t === OWNER)
        return { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "skill-walk" };
      if (t === AGENT)
        return {
          space: "spc_core",
          principal: { kind: "agent", id: "agt_scout" },
          actingFor: "usr_olivia",
          device: "skill-walk",
        };
      return null;
    },
    intervals: {
      fast: 3_600_000,
      slow: 3_600_000,
      encryption: 3_600_000,
      commands: 3_600_000,
      hooks: 3_600_000,
      tick: 200,
    },
  } satisfies DaemonOptions);
  const replies: string[] = [];
  let stopped = false;
  const post = async (who: string, cap: string, body: Record<string, unknown>) => {
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${who}` },
      body: JSON.stringify({ idempotencyKey: `${cap}-${Math.random()}`, ...body }),
      signal: AbortSignal.timeout(8_000),
    });
    const text = await r.text();
    replies.push(text);
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
    return { status: r.status, data: (json["data"] as Record<string, unknown> | undefined) ?? {}, text };
  };
  try {
    // the person's setup: a key in the Vault, the assistant allowed to build connectors, a chat to post cards in
    const folder = await post(OWNER, "vault.folders.create", { name: "Keys", scope: "shared" });
    const put = await post(OWNER, "vault.item.put", {
      folderId: String((folder.data["folder"] as { id?: string }).id),
      name: "Notely",
      kind: "api_key",
      fields: [{ key: "api_key", value: SECRET }],
    });
    assert.equal(put.status, 200, put.text);
    assert.equal((await post(OWNER, "access.connector_builder.grant", { agentId: "agt_scout" })).status, 200);
    const chat = await post(OWNER, "chat.start", { kind: "chat", agentIds: ["agt_scout"] });
    const threadId = String((chat.data["thread"] as { threadId?: string }).threadId);

    // 1. Check first
    const use = await post(AGENT, "vault.use", { item: "Notely", fields: ["api_key"] });
    assert.equal(use.status, 200, use.text);
    const handle = String(use.data["handle"]);
    const listed = await post(AGENT, "connectors.list", {});
    assert.equal(listed.status, 200, listed.text);
    // 2. Find the docs
    // a docs address the agent put together itself waits for the person (an address can carry data); the person presses Allow and the read goes
    const docs = await post(AGENT, "automations.read_docs", { url: "https://docs.notely.example/api" });
    assert.equal(docs.data["status"], "held", `a composed docs link waits for the person: ${docs.text}`);
    const allowDocs = await post(OWNER, "tasks.act", { taskId: String(docs.data["taskId"]), action: "approve" });
    assert.equal(allowDocs.status, 200, allowDocs.text);
    for (let i = 0; i < 40 && !dialled.some((x) => x.host === "docs.notely.example"); i++)
      await new Promise((r) => setTimeout(r, 100));
    assert.ok(
      dialled.some((x) => x.host === "docs.notely.example" && !x.key),
      "the approved docs read went out, with no key",
    );
    // 3. Offer options: the person picks "List notes" (ask_question is the person's turn; not played here)
    // 4. Build
    assert.equal(
      (await post(AGENT, "connectors.init", { key: "notely", title: "Notely", mode: "api", source: false })).status,
      200,
    );
    const def = await post(AGENT, "connectors.define", {
      key: "notely",
      title: "Notely",
      domains: ["api.notely.example"],
      auth: { type: "api_key", header: "X-Api-Key", prefix: "", secret: "api_key" },
      secrets: [{ name: "api_key", description: "Notely key" }],
      actions: [{ name: "list_notes", method: "GET", url: "https://api.notely.example/v1/notes" }],
    });
    assert.equal(def.status, 200, def.text);
    // 5. Test every read: the first read waits for the person (api.notely.example is not approved for this key yet)
    const read = {
      method: "GET",
      path: "/v1/notes",
      domains: ["api.notely.example"],
      vaultItemId: `${handle}.api_key`,
      header: "X-Api-Key",
      prefix: "",
      actionKey: "notely.list_notes",
    };
    const first = await post(AGENT, "automations.try_read", read);
    assert.equal(first.data["status"], "held", `the first read waits for the person: ${first.text}`);
    assert.equal(dialled.filter((x) => x.key).length, 0, "nothing carried the key before the person answered");
    // the person presses Always allow on the card: the host is kept on the key, then the read goes
    assert.equal(
      (await post(OWNER, "automations.key_hosts.allow", { vaultItemId: handle, host: "api.notely.example" })).status,
      200,
    );
    const tested = await post(AGENT, "automations.try_read", read);
    assert.equal(tested.data["level"], "tested", tested.text);
    const card = await post(AGENT, "automations.connector_card", {
      threadId,
      title: "Read tests",
      items: [{ text: "List notes: 200", done: true }],
    });
    assert.equal(card.status, 200, card.text);
    // 6. Review: the person says Publish. 7. Publish and bind
    const pub = await post(AGENT, "connectors.publish", { key: "notely" });
    assert.equal(pub.data["published"], true, pub.text);
    const bound = await post(AGENT, "connections.create", {
      connector: "notely",
      title: "Notely",
      ownerKind: "space",
      secrets: { api_key: `${handle}.api_key` },
    });
    assert.equal(bound.status, 200, bound.text);
    // 8. Confirm
    const live = await post(AGENT, "connectors.list", { state: "live" });
    assert.match(live.text, /"notely"/, live.text);

    assert.deepEqual(
      [...new Set(dialled.filter((x) => x.key).map((x) => x.host))],
      ["api.notely.example"],
      "the key went only to the approved API host",
    );
    for (const r of replies) assert.equal(r.includes(SECRET), false, `a reply held the key: ${r.slice(0, 200)}`);
    // every database and log the daemon wrote: the key's plain text is in none of them (the Vault keeps it sealed)
    await d.stop();
    stopped = true;
    const files: string[] = [];
    const walk = (p: string): void => {
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        const f = path.join(p, e.name);
        if (e.isDirectory()) walk(f);
        else files.push(f);
      }
    };
    walk(dir);
    const holding = files.filter((f) => fs.readFileSync(f).includes(Buffer.from(SECRET)));
    assert.deepEqual(
      holding.map((f) => path.relative(dir, f)),
      [],
      "no file the daemon wrote holds the key in plain text",
    );
  } finally {
    if (!stopped) await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
