// What an agent is told when a connector or connection call is refused (F36, F37, 14 Nov 2026): whose role is short (the agent's, the person's, both) and what fixes it; and which kind of thing was not found and
// the name the caller gave, the same for a thing that is missing and one that is only hidden. A key the person cannot use says whether it is missing or Restricted. Real daemon, real access rules, no model.
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
  } finally {
    clearInterval(pump);
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
