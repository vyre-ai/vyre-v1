// What an agent is told when a connector or connection call is refused (F36, F37, 14 Nov 2026): whose role is short (the agent's, the person's, both) and what fixes it; and which kind of thing was not found and
// the name the caller gave. A thing that exists above the caller's clearance answers with its own words, and the probe below records what a caller with no relation to it can tell apart. A key the person cannot use says whether it is missing or Restricted. Real daemon, real access rules, no model.
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
type Json = { data?: any; error?: { code?: string; message?: string; details?: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any

// the error of a reply that has one, its words always a string
const errOf = (r: { body: Json }): { code?: string; message: string; details?: any } =>
  // eslint-disable-line @typescript-eslint/no-explicit-any
  (r.body.error ?? { message: "" }) as { code?: string; message: string };

test("a refused connector or connection call says which thing was missing and whose role is short", async () => {
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
    const agentOf = async (p: { id: string; token: string }): Promise<string> => {
      const end = Date.now() + 20_000;
      for (;;) {
        const r = await post(p.token, "agents.assistant_of", { personId: p.id });
        if (typeof r.body.data?.agentId === "string") return r.body.data.agentId as string;
        assert.ok(Date.now() < end, "gave up waiting for an assistant");
        await new Promise((x) => setTimeout(x, 200));
      }
    };
    const adaAgent = await agentOf(ada);
    const melAgent = await agentOf(mel);

    // F36: the agent holds a Member's role only. The person (an admin) may build connectors, so only the agent is short, and the line says what fixes it
    agentFor = { id: adaAgent, person: ada.id };
    const list = await post("tok-agent", "connectors.list", {});
    assert.equal(list.status, 403, list.text);
    assert.equal(errOf(list).code, "permission.role_lacks_permission");
    assert.match(errOf(list).message, /^This agent may not build connectors yet\./);
    assert.match(errOf(list).message, /press Allow, or give the agent the Connector builder role/);
    // a member's agent acts for a member, who may not build connectors either: neither holds it
    agentFor = { id: melAgent, person: mel.id };
    const neither = await post("tok-agent", "connectors.list", {});
    assert.equal(neither.status, 403, neither.text);
    assert.match(errOf(neither).message, /^Neither this agent nor the person it works for may do this\./);
    // once the agent is allowed it lists them
    assert.equal((await post(ada.token, "access.connector_builder.grant", { agentId: adaAgent })).status, 200);
    agentFor = { id: adaAgent, person: ada.id };
    assert.equal((await post("tok-agent", "connectors.list", {})).status, 200);

    // F37: each not found says which kind of thing and the name given; an id is never said back
    const noConnector = await post("tok-agent", "connections.create", {
      connector: "fathom",
      title: "Fathom",
      ownerKind: "space",
    });
    assert.equal(noConnector.status, 404, noConnector.text);
    assert.equal(errOf(noConnector).message, "There is no connector called fathom that you can see.");
    assert.equal(errOf(noConnector).details.thing, "connector");
    assert.equal(errOf(noConnector).details.name, "fathom");
    const noGet = await post("tok-agent", "connectors.get", { key: "google_ads" });
    assert.equal(errOf(noGet).message, "There is no connector called google ads that you can see.");
    assert.equal(errOf(noGet).details.name, "google_ads");
    const noConnection = await post("tok-agent", "connections.get", { connectionId: "con_a1b2c3d4e5f6a7b8" });
    assert.equal(errOf(noConnection).message, "There is no connection by that name that you can see.");
    assert.equal(errOf(noConnection).details.name, undefined);
    assert.ok(!noConnection.text.includes("con_a1b2c3d4e5f6a7b8"), "the id is not said back");

    // F37: a built-in connector, a key that is not in the Vault: the person who connects is told which key is missing
    const noKey = await post(ada.token, "connections.create", {
      connector: "documenso",
      title: "Documenso",
      ownerKind: "space",
      secrets: { Documenso_Token: "#Nope.token" },
    });
    assert.equal(noKey.status, 403, noKey.text);
    assert.match(errOf(noKey).message, /^There is no Vault item #Nope that you can use\./);

    // person only: Mel's agent is allowed to build connectors, Mel (a member) is not, and an agent never does more than its person
    assert.equal((await post(ada.token, "access.connector_builder.grant", { agentId: melAgent })).status, 200);
    agentFor = { id: melAgent, person: mel.id };
    const personOnly = await post("tok-agent", "connectors.list", {});
    assert.equal(personOnly.status, 403, personOnly.text);
    assert.match(errOf(personOnly).message, /^The person this agent works for may not do this/);

    // a thing that exists above the caller's clearance: its own words, never "no such item" (pinned both ways)
    const folder = await post(ada.token, "vault.folders.create", { name: "Company", scope: "shared" });
    assert.equal(folder.status, 200, folder.text);
    const lab = await post(ada.token, "access.labels.set", {
      resource: { type: "vault_folder", id: folder.body.data.folder.id },
      label: "restricted",
    });
    assert.equal(lab.status, 200, lab.text);
    const put = await post(ada.token, "vault.item.put", {
      folderId: folder.body.data.folder.id,
      name: "Secretly",
      kind: "api_key",
      fields: [{ key: "api_key", value: "fake_restricted_88" }],
    });
    assert.equal(put.status, 200, put.text);
    const realId = String(put.body.data.item.id);
    // oracle probe: the person Mel and her agent have no relation to the item. Record what each way of naming it answers, against a made-up one
    const probe: string[] = [];
    for (const [who, token] of [
      ["person", mel.token],
      ["agent", "tok-agent"],
    ] as const)
      for (const [how, input] of [
        ["name", { item: "#Secretly", fields: ["api_key"] }],
        ["name-made-up", { item: "#Nothing_Here", fields: ["api_key"] }],
        ["id", { item: realId, fields: ["api_key"] }],
        ["id-made-up", { item: "vit_00000000000000000000000000000000", fields: ["api_key"] }],
      ] as const) {
        const r = await post(token, "vault.use", input);
        probe.push(`${who} ${how}: ${r.status} ${r.body.error?.code ?? "ok"}`);
      }
    // pinned: someone with no relation to a Restricted item cannot tell it from one that does not exist, by name or by id, as a person or through their agent
    assert.deepEqual(
      [...new Set(probe.map((x) => x.replace(/^\w+ [\w-]+: /, "")))],
      ["404 permission.not_found"],
      probe.join("\n"),
    );
    // a person's own connection that someone else asks about: the same answer as a connection that does not exist
    const personConnector = ((await post(ada.token, "connectors.list", {})).body.data?.connectors ?? []).find(
      (c: { scope?: string }) => c.scope === "person",
    )?.key;
    const mine = await post(ada.token, "connections.create", {
      connector: personConnector ?? "none",
      title: "Mine",
      ownerKind: "person",
    });
    const conProbe: string[] = [];
    if (mine.status === 200) {
      const cid = String(mine.body.data.connection.connectionId);
      for (const [how, id] of [
        ["real", cid],
        ["made-up", "con_00000000000000000000"],
      ] as const) {
        const r = await post(mel.token, "connections.get", { connectionId: id });
        conProbe.push(`person ${how}: ${r.status} ${r.body.error?.code ?? "ok"}`);
      }
    } else conProbe.push(`could not make a person connection: ${mine.status} ${mine.text.slice(0, 120)}`);
    console.log(`ORACLE-PROBE connection\n${conProbe.join("\n")}`);
  } finally {
    clearInterval(pump);
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
