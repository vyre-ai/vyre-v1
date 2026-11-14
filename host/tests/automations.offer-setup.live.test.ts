// The owner's exact path, on a real daemon with real access rules and a real Assistant (no model): an admin is offered Set up for a Vault key, presses Set up (which allows the Assistant to build connectors,
// the same two calls the app makes: connector_builder.status, then .grant), and the Assistant then builds the connector as the agent: it exists, and its first read works. Before Allow the same calls
// are refused. A member is offered nothing and their Assistant is refused. The key's value is in no reply.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
const SECRET = "fake_notely_setup_71";
const KEYS = {
  personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk",
  publicKey: "cHVibGljLWtleQ==",
  privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk",
  spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }],
};
const PASSWORD = "correct horse battery staple 9";
type Json = { data?: any; error?: { code?: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any

test("offer, Set up, Allow, the connector exists and its first read works; a member gets no offer", async () => {
  const dialled: { host: string; key: boolean }[] = [];
  let agentFor: { id: string; person: string } | null = null;
  let ownerToken = "";
  const people = new Map<string, string>();
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-offer-setup-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux",
      hostname: "offer-setup",
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
            if (r.url.hostname === "api.notely.example" && r.url.pathname === "/v1/notes")
              return new Response('{"notes":[]}', { status: 200, headers: { "content-type": "application/json" } });
            return new Response("not found", { status: 404 });
          },
        }),
      },
    },
    // this stand-in resolves every token itself: the owner's local token, the people who joined (their session tokens, remembered below) and the Assistant's token
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1] ?? "";
      if (t === "tok-agent" && agentFor)
        return {
          space: "spc_core",
          principal: { kind: "agent", id: agentFor.id },
          actingFor: agentFor.person,
          device: "offer-setup",
        };
      if (t === ownerToken)
        return { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "offer-setup" };
      const who = people.get(t);
      return who ? { space: "spc_core", principal: { kind: "person", id: who }, device: "offer-setup" } : null;
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
  } satisfies DaemonOptions);
  ownerToken = d.token;
  const pump = setInterval(() => void d.hooks?.pump?.(), 150);
  const replies: string[] = [];
  const post = async (
    token: string,
    cap: string,
    body: unknown,
  ): Promise<{ status: number; body: Json; text: string }> => {
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ idempotencyKey: `${cap}-${Math.random()}`, ...(body as object) }),
      signal: AbortSignal.timeout(8_000),
    });
    const text = await r.text();
    replies.push(text);
    return { status: r.status, body: text ? (JSON.parse(text) as Json) : {}, text };
  };
  const joinAs = async (name: string, role: string): Promise<{ id: string; token: string }> => {
    const invite = await post(d.token, "members.invites.create", { role });
    assert.equal(invite.status, 200, invite.text);
    const code = decodeURIComponent(new URL(invite.body.data.link as string).pathname.split("/").pop() ?? "");
    const r = await fetch(`${d.url}/v1/members/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code,
        username: name,
        password: PASSWORD,
        deviceName: "Mac",
        deviceClass: "desktop",
        keys: KEYS,
      }),
    });
    const body = (await r.json()) as Json;
    assert.equal(r.status, 200, JSON.stringify(body));
    people.set(body.data.token as string, body.data.personId as string);
    return { id: body.data.personId as string, token: body.data.token as string };
  };
  const until = async <T>(what: string, look: () => Promise<T | undefined>): Promise<T> => {
    const end = Date.now() + 20_000;
    for (;;) {
      const v = await look();
      if (v !== undefined) return v;
      assert.ok(Date.now() < end, `gave up waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  };
  const offersOf = async (token: string): Promise<{ itemId: string; appName: string; text: string }[]> =>
    (await post(token, "automations.connector_offers", {})).body.data.offers ?? [];
  try {
    const ada = await joinAs("ada", "rol_admin");
    const mel = await joinAs("mel", "rol_member");
    const folder = await post(ada.token, "vault.folders.create", { name: "Keys", scope: "shared" });
    const put = await post(ada.token, "vault.item.put", {
      folderId: folder.body.data.folder.id,
      name: "Notely",
      kind: "api_key",
      fields: [{ key: "api_key", value: SECRET }],
    });
    assert.equal(put.status, 200, put.text);
    const itemId = String(put.body.data.item.id);
    const assistantOf = async (p: { id: string; token: string }): Promise<string> =>
      String(
        (
          await until("an assistant", async () => {
            const r = await post(p.token, "agents.assistant_of", { personId: p.id });
            return typeof r.body.data.agentId === "string" ? r : undefined;
          })
        ).body.data.agentId,
      );
    const adaAgent = await assistantOf(ada);
    const melAgent = await assistantOf(mel);

    // 1. the offer: shown to the admin, with what Set up also does; a member has none
    const offer = await until("the admin's offer", async () =>
      (await offersOf(ada.token)).find((o) => o.itemId === itemId),
    );
    assert.match(offer.text, /allowed to build connectors/);
    assert.deepEqual(await offersOf(mel.token), [], "a member is offered nothing");

    // 2. before Allow the Assistant is refused, which is the dead end he met
    agentFor = { id: adaAgent, person: ada.id };
    const refused = await post("tok-agent", "connectors.list", {});
    assert.notEqual(refused.status, 200, "the Assistant may not list connectors before it is allowed");
    assert.match(refused.text, /permission\./);

    // 3. Set up: the app checks the status, then allows the Assistant (one press), then accepts the offer
    const st = await post(ada.token, "access.connector_builder.status", { agentId: adaAgent, itemId });
    assert.deepEqual(st.body.data, { allowed: false, canGrant: true, reaches: true });
    assert.equal((await post(ada.token, "access.connector_builder.grant", { agentId: adaAgent })).status, 200);
    assert.equal((await post(ada.token, "automations.connector_offer.accept", { itemId })).status, 200);

    // 4. the Assistant builds the connector, in the skill's order
    const use = await post("tok-agent", "vault.use", { item: "Notely", fields: ["api_key"] });
    assert.equal(use.status, 200, use.text);
    const handle = String(use.body.data.handle);
    assert.equal((await post("tok-agent", "connectors.list", {})).status, 200);
    assert.equal(
      (await post("tok-agent", "connectors.init", { key: "notely", title: "Notely", mode: "api", source: false }))
        .status,
      200,
    );
    const def = await post("tok-agent", "connectors.define", {
      key: "notely",
      title: "Notely",
      domains: ["api.notely.example"],
      auth: { type: "api_key", header: "X-Api-Key", prefix: "", secret: "api_key" },
      secrets: [{ name: "api_key", description: "Notely key" }],
      actions: [{ name: "list_notes", method: "GET", url: "https://api.notely.example/v1/notes" }],
    });
    assert.equal(def.status, 200, def.text);
    const read = {
      method: "GET",
      path: "/v1/notes",
      domains: ["api.notely.example"],
      vaultItemId: `${handle}.api_key`,
      header: "X-Api-Key",
      prefix: "",
      actionKey: "notely.list_notes",
    };
    assert.equal(
      (await post("tok-agent", "automations.try_read", read)).body.data.status,
      "held",
      "the first read waits for the person",
    );
    assert.equal(
      (await post(ada.token, "automations.key_hosts.allow", { vaultItemId: handle, host: "api.notely.example" }))
        .status,
      200,
    );
    const tested = await post("tok-agent", "automations.try_read", read);
    assert.equal(tested.body.data.level, "tested", tested.text);
    assert.equal((await post("tok-agent", "connectors.publish", { key: "notely" })).body.data.published, true);
    const bound = await post("tok-agent", "connections.create", {
      connector: "notely",
      title: "Notely",
      ownerKind: "space",
      secrets: { api_key: `${handle}.api_key` },
    });
    assert.equal(bound.status, 200, bound.text);
    assert.match(
      (await post("tok-agent", "connectors.list", { state: "live" })).text,
      /"notely"/,
      "the connector exists afterwards",
    );
    assert.deepEqual([...new Set(dialled.filter((x) => x.key).map((x) => x.host))], ["api.notely.example"]);

    // 5. the member's Assistant is refused: no offer, and no way in
    agentFor = { id: melAgent, person: mel.id };
    assert.notEqual((await post("tok-agent", "connectors.list", {})).status, 200);
    for (const r of replies) assert.equal(r.includes(SECRET), false, `a reply held the key: ${r.slice(0, 160)}`);
  } finally {
    clearInterval(pump);
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
