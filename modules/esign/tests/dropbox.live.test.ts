// Dropbox Sign and DocuSign on a booted daemon (rule 27): esign is live, the two providers are configured with scripted HTTP, and everything below goes the way a person does,
// over the gateway with a real session token. Nothing is called on a handler directly.
// What is proven: the providers list shows both as connected; choosing the default needs connectors.manage (a member is refused with 403, the owner succeeds, a call with no
// token gets 401); inbound callbacks from each provider pass through esign.hook with the provider's own checks (a Dropbox Sign callback with a wrong hash is refused with 400,
// a valid one for a document that is not ours is accepted and changes nothing, a DocuSign Connect message likewise).
// This file is named dropbox*.test.ts because that is the pattern the packet owns; it covers both providers of P-L8_06. host/modules.json still says esign is a stub (the live flip
// is P-L8_LIVE, ruling 25), so the daemon boots from a copy of the code root whose modules.json has esign live; every other file is a symlink to the real one.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../../../host/src/platform/index.ts";
import type { FetchFn } from "../../../host/src/platform/probes.ts";
import { loadConfig } from "../../../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../../../host/src/daemon/daemon.ts";
import type { Daemon } from "../../../host/src/daemon/daemon.ts";
import { configureEsign } from "../handlers/send.ts";
import { dropboxSign, hmacSha256Hex } from "../handlers/dropbox.ts";
import { docusign } from "../handlers/docusign.ts";
import type { HttpFn } from "../handlers/documenso.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));

const OWNER = "tok-usr_olivia";
const MEMBER = "tok-usr_noah";
const API_KEY = "db_sign_live_key";

function seededDir(): string {
  const core = bootCore();
  const dir = tmp("vyre-esign-live-");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

/** A code root that is the real one, except host/modules.json lists esign as live. */
function codeRootWithEsignLive(): string {
  const root = tmp("vyre-esign-root-");
  for (const name of fs.readdirSync(CODE_ROOT)) {
    if (name.startsWith(".") || name === "host") continue;
    fs.symlinkSync(path.join(CODE_ROOT, name), path.join(root, name));
  }
  fs.mkdirSync(path.join(root, "host"));
  for (const name of fs.readdirSync(path.join(CODE_ROOT, "host"))) {
    if (name !== "modules.json") fs.symlinkSync(path.join(CODE_ROOT, "host", name), path.join(root, "host", name));
  }
  const list = JSON.parse(fs.readFileSync(path.join(CODE_ROOT, "host/modules.json"), "utf8")) as { modules: { id: string; status: string }[] };
  const esign = list.modules.find((m) => m.id === "esign");
  assert.ok(esign, "esign is in host/modules.json");
  esign.status = "live";
  fs.writeFileSync(path.join(root, "host/modules.json"), JSON.stringify(list));
  return root;
}

async function boot(dir: string, codeRoot: string): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot,
    platform: fakePlatform({
      os: "linux", hostname: "esign-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    // two real people from the seeded Space: the owner (Olivia) and a member (Noah)
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      const who = t === OWNER ? "usr_olivia" : t === MEMBER ? "usr_noah" : null;
      return who === null ? null : { space: "spc_core", principal: { kind: "person", id: who }, device: "esign-live" };
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
}

async function post(d: Daemon, token: string | null, cap: string, body: unknown): Promise<{ status: number; body: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, {
    method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

// providers that never reach the network: every call is a 503, so a handler that tried to confirm something with them would show
const down: HttpFn = async () => ({ status: 503, ok: false, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) });

test("esign live: a booted daemon lists both providers as connected, only a member with connectors.manage chooses the default, and a call with no token is refused", async () => {
  const dir = seededDir();
  const root = codeRootWithEsignLive();
  configureEsign({ providers: {
    dropbox_sign: dropboxSign({ apiKey: API_KEY, http: down }),
    docusign: docusign({ integrationKey: "ik", userId: "u", accountId: "a", baseUri: "https://demo.docusign.net", privateKey: "unused here", http: down }),
  } });
  const d = await boot(dir, root);
  try {
    assert.deepEqual((d.seams?.missing ?? []).filter((m) => m.module === "esign"), [], "esign is not reported as missing a driver");

    const none = await post(d, null, "esign.providers", {});
    assert.equal(none.status, 401, "no token, no answer");

    const listed = await post(d, OWNER, "esign.providers", {});
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    assert.deepEqual(listed.body.data.providers, [
      { key: "documenso", default: true, connected: false },
      { key: "dropbox_sign", default: false, connected: true },
      { key: "docusign", default: false, connected: true },
    ]);

    const refused = await post(d, MEMBER, "esign.provider_set", { provider: "dropbox_sign" });
    assert.equal(refused.status, 403, JSON.stringify(refused.body));
    assert.equal(refused.body.error?.code, "permission.role_lacks_permission");
    assert.equal((await post(d, OWNER, "esign.providers", {})).body.data.providers.find((p: { default: boolean }) => p.default).key, "documenso", "the refused call changed nothing");

    const set = await post(d, OWNER, "esign.provider_set", { provider: "dropbox_sign" });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.equal((await post(d, OWNER, "esign.providers", {})).body.data.providers.find((p: { default: boolean }) => p.default).key, "dropbox_sign");
    const notConnected = await post(d, OWNER, "esign.provider_set", { provider: "documenso" });
    assert.notEqual(notConnected.status, 200, "a provider that is not connected cannot become the default");
  } finally {
    await d.stop();
    configureEsign(null);
  }
});

test("esign live: callbacks from both providers go through esign.hook over the gateway; a forged Dropbox Sign hash is refused, genuine ones for documents that are not ours change nothing", async () => {
  const dir = seededDir();
  const root = codeRootWithEsignLive();
  configureEsign({ providers: {
    dropbox_sign: dropboxSign({ apiKey: API_KEY, http: down }),
    docusign: docusign({ integrationKey: "ik", userId: "u", accountId: "a", baseUri: "https://demo.docusign.net", privateKey: "unused here", http: down }),
  } });
  const d = await boot(dir, root);
  try {
    const dropbox = (type: string, time: string, key: string) => ({
      provider: "dropbox_sign",
      payload: { event: { event_time: time, event_type: type, event_hash: hmacSha256Hex(key, time + type), event_metadata: {} }, signature_request: { signature_request_id: "sr_not_ours", signatures: [] } },
    });
    const forged = await post(d, OWNER, "esign.hook", dropbox("signature_request_all_signed", "1761390000", "someone else's key"));
    assert.equal(forged.status, 400, JSON.stringify(forged.body));
    assert.equal(forged.body.error?.code, "validation.bad_input");

    const genuine = await post(d, OWNER, "esign.hook", dropbox("signature_request_all_signed", "1761390000", API_KEY));
    assert.equal(genuine.status, 200, JSON.stringify(genuine.body));
    assert.deepEqual(genuine.body.data, { ok: true });

    const test_ = await post(d, OWNER, "esign.hook", dropbox("callback_test", "1761390001", API_KEY));
    assert.equal(test_.status, 200, "Dropbox Sign's callback test is accepted");

    const connect = await post(d, OWNER, "esign.hook", { provider: "docusign", payload: { event: "envelope-completed", generatedDateTime: "2026-10-25T10:00:00.000Z", data: { envelopeId: "env-not-ours" } } });
    assert.equal(connect.status, 200, JSON.stringify(connect.body));
    assert.deepEqual(connect.body.data, { ok: true });

    const junk = await post(d, OWNER, "esign.hook", { provider: "docusign", payload: { hello: "world" } });
    assert.equal(junk.status, 400, JSON.stringify(junk.body));

    const noToken = await post(d, null, "esign.hook", dropbox("signature_request_all_signed", "1761390000", API_KEY));
    assert.equal(noToken.status, 401, "an unauthenticated POST never reaches the hook");

    const none = await post(d, OWNER, "esign.list", {});
    assert.equal(none.status, 200, JSON.stringify(none.body));
    assert.deepEqual(none.body.data.envelopes, [], "nothing was created by those callbacks");
  } finally {
    await d.stop();
    configureEsign(null);
  }
});
