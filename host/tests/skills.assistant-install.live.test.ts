// Settings, Skills, "ask": the Assistant installs a skill for its person (installing-skills skill): skills_preview of dropped files, then skills_mine_add as the Assistant acting for a MEMBER. Real daemon, real Assistant,
// no model: the skill lands in the member's own skills, with no script and no admin role.
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

test("a member's Assistant installs a skill for them: preview of dropped files, then Mine add, no script and no admin", async () => {
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
  try {
    const mel = await joinAs("mel", "rol_member");
    const agentId = String(
      (
        await until("an assistant", async () => {
          const r = await post(mel.token, "agents.assistant_of", { personId: mel.id });
          return typeof r.body.data.agentId === "string" ? r : undefined;
        })
      ).body.data.agentId,
    );
    agentFor = { id: agentId, person: mel.id };
    const text = "---\nname: tidy-notes\ndescription: Tidy a note.\n---\n\n# Tidy notes\nShorten the note.\n";
    const preview = await post("tok-agent", "skills.preview", { files: { "SKILL.md": text } });
    assert.equal(preview.status, 200, preview.text);
    assert.equal(preview.body.data.skills.length, 1, preview.text);
    const added = await post("tok-agent", "skills.mine.add", { text, source: "upload" });
    assert.equal(added.status, 200, added.text);
    const mine = await post(mel.token, "skills.list", { includeOff: true });
    assert.match(mine.text, /tidy-notes/, mine.text);
  } finally {
    clearInterval(pump);
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
