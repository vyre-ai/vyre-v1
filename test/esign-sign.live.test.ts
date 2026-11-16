// Built-in signing, end to end on a booted Space (lane r33-sign-core, 17 Nov 2026). A fresh Space with NO provider account, NO key and NO mailbox: Imran Ibarra's side (the Space's owner) sends a PDF for
// signature to Andrea Lindahl at northwind.example; she opens the link with no session, signs in the page's own way, and the sender reads the signed file back from Files with its audit page. Then the same
// through the relay's box half (servePublic: only /p/*, no cookie, no Authorization, the visitor named by the relay). Nothing is ever sent to a real address: the sample people and domain are invented and the
// Space has no mailbox, so no mail leaves.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../fixtures/seed/core/index.ts";
import { fakePlatform } from "../host/src/platform/index.ts";
import type { FetchFn } from "../host/src/platform/probes.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { startDaemon } from "../host/src/daemon/daemon.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import { servePublic } from "../host/src/seams/relay.ts";
import type { SeamFetch } from "../host/src/seams/ports.ts";
import { samplePdf, samplePng, textOf } from "../modules/esign/fixtures/pdf.ts";

const OWNER = "tok-usr_olivia";
const { spawnSync } = process.getBuiltinModule("node:child_process");
const caddyFetch: FetchFn = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve('{"apps":{"http":{}}}'),
  });

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-sign-live-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}
const boot = (dir: string, extra: Record<string, unknown> = {}): Promise<Daemon> =>
  startDaemon({
    ...extra,
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux",
      hostname: "sign-live",
      free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      return t === OWNER
        ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "sign-live" }
        : null;
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });

let n = 0;
const cap = async (d: Daemon, name: string, body: Record<string, unknown> = {}): Promise<Record<string, any>> => {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${name.replaceAll(".", "/")}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` },
    body: JSON.stringify({ idempotencyKey: `sign-live-${++n}`, ...body }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await r.text();
  assert.equal(r.status, 200, `${name}: ${text}`);
  return (JSON.parse(text) as { data: Record<string, any> }).data; // eslint-disable-line @typescript-eslint/no-explicit-any
};
/** A folder of the owner's own to keep the sample files in. */
async function home(d: Daemon): Promise<string> {
  const roots = (await cap(d, "files.tree")).roots as { key: string; folderId?: string }[];
  const personal = roots.find((r) => r.key === "personal")?.folderId;
  assert.ok(personal, "the owner has a Personal folder");
  const made = await cap(d, "files.folder.create", { parentId: personal, name: "Signing samples" });
  return (made.folder?.folderId ?? made.folder?.id ?? made.folderId) as string;
}
const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

interface Answer {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}
/** What an outside person's browser does with no session: a plain request to the Space's own address. */
const direct = async (d: Daemon, method: string, p: string, json?: unknown): Promise<Answer> => {
  const r = await fetch(`${d.url}${p}`, {
    method,
    headers: json === undefined ? {} : { "content-type": "application/json" },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
    signal: AbortSignal.timeout(20_000),
  });
  return { status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()) };
};
/** The same request the way the relay hands it to the box: servePublic only, the visitor's address named by the relay, any cookie or Authorization dropped on the way. */
const relayed = (d: Daemon, method: string, p: string, json?: unknown, ip = "203.0.113.44"): Promise<Answer> =>
  new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let head: { status: number; headers: Record<string, string> } | null = null;
    const body = json === undefined ? new Uint8Array(0) : new TextEncoder().encode(JSON.stringify(json));
    servePublic(
      (m) => {
        const x = m as { t: string; status?: number; headers?: Record<string, string>; b?: string };
        if (x.t === "p.res") head = { status: x.status as number, headers: x.headers ?? {} };
        else if (x.t === "p.data") parts.push(Buffer.from(x.b as string, "base64"));
        else if (x.t === "p.end") resolve({ ...(head as NonNullable<typeof head>), body: Buffer.concat(parts) });
        else if (x.t === "p.err") reject(new Error("the relay's request failed"));
      },
      {
        id: `r${++n}`,
        method,
        path: p,
        ip,
        headers: {
          "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Test",
          cookie: "vyre_session=stolen",
          authorization: `Bearer ${OWNER}`,
          ...(json === undefined ? {} : { "content-type": "application/json" }),
        },
      },
      body,
      Number(new URL(d.url).port),
    );
  });

test("a fresh Space with no provider, no key and no mailbox: send, the outside person signs with no account, the sender reads the signed file and its audit page", async () => {
  const d = await boot(seededDir());
  try {
    // nothing is connected, and signing is ready anyway
    const providers = await cap(d, "esign.providers");
    const vyre = providers.providers.find((p: { key: string }) => p.key === "vyre");
    assert.deepEqual([vyre.default, vyre.connected], [true, true]);
    assert.ok(
      providers.providers
        .filter((p: { key: string }) => p.key !== "vyre")
        .every((p: { connected: boolean }) => !p.connected),
    );
    assert.deepEqual(await cap(d, "esign.health"), { state: "healthy", detail: "Built-in signing is ready." });

    // a PDF in Files
    const original = await samplePdf(2, "Northwind services agreement");
    const made = await cap(d, "files.create", {
      folderId: await home(d),
      name: "Northwind services agreement.pdf",
      mime: "application/pdf",
      content: { base64: Buffer.from(original).toString("base64") },
    });
    const fileId = made.file.fileId as string;
    assert.ok(fileId);

    // send: no mailbox, so the link comes back to copy and the answer says so in plain words
    const sent = await cap(d, "esign.send", {
      fileId,
      signers: [{ name: "Andrea Lindahl", email: "andrea@northwind.example" }],
      message: "Please sign by Friday.",
    });
    assert.match(sent.envelopeId, /^env_/);
    assert.equal(sent.links.length, 1);
    assert.match(sent.links[0].path, /^\/p\/sign\/[A-Za-z0-9_-]{43}\/$/);
    assert.match(sent.notice, /no sending mailbox/);
    assert.deepEqual(sent.emailed, []);
    const link = sent.links[0].path as string;

    // the outside person: no session at all
    const page = await direct(d, "GET", link);
    assert.equal(page.status, 200);
    assert.match(page.body.toString(), /<script type="module" src="\.\/assets\/sign\.js">/);
    assert.equal(page.headers["set-cookie"], undefined);
    assert.equal((await direct(d, "GET", `${link}assets/sign.js`)).status, 200);
    const view = await direct(d, "POST", `${link}view`, {});
    assert.equal(view.status, 200);
    const session = (JSON.parse(view.body.toString()) as { data: Record<string, any> }).data; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(session.state, "ready");
    assert.equal(session.title, "Northwind services agreement");
    assert.equal(session.message, "Please sign by Friday.");
    assert.equal(session.signer.name, "Andrea Lindahl");
    assert.deepEqual(Object.keys(session.sender), ["name"]);
    assert.equal(session.pages.length, 3);
    assert.equal(session.places.length, 2);
    const pdf = await direct(d, "GET", `${link}doc`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers["content-type"], "application/pdf");
    assert.match(textOf(pdf.body), /Signature page/);
    assert.equal((await cap(d, "esign.status", { envelopeId: sent.envelopeId })).status, "viewed");

    // she signs by typing her name
    const done = await direct(d, "POST", `${link}sign`, {
      name: "Andrea Lindahl",
      consent: true,
      signature: { kind: "typed", text: "Andrea Lindahl" },
    });
    assert.equal(done.status, 200, done.body.toString());
    assert.deepEqual(JSON.parse(done.body.toString()), {
      data: { state: "signed", completed: true, copyAvailable: true },
    });
    // the link is spent
    assert.equal((await direct(d, "POST", `${link}view`, {})).status, 404);
    assert.equal((await direct(d, "GET", `${link}doc`)).status, 404);
    // her copy, the one thing a spent link still answers
    const copy = await direct(d, "POST", `${link}copy`, {});
    assert.equal(copy.status, 200);
    assert.equal(copy.headers["content-type"], "application/pdf");

    // the sender: the final file is in Files beside the original, the original is untouched
    const st = await cap(d, "esign.status", { envelopeId: sent.envelopeId });
    assert.equal(st.status, "signed");
    assert.ok(st.signedFileId && st.signedFileId !== fileId);
    const finalRead = await cap(d, "files.read", { fileId: st.signedFileId, as: "base64" });
    const finalBytes = Buffer.from(finalRead.base64 as string, "base64");
    assert.equal(sha(finalBytes), st.finalSha256, "the SHA-256 of the file in Files is the one the envelope holds");
    assert.deepEqual(finalBytes, copy.body, "the signer's copy is the same file");
    const text = textOf(finalBytes);
    assert.match(text, /Signed by Andrea Lindahl/);
    assert.match(text, /Audit page/);
    assert.match(text, /andrea@northwind\.example/);
    assert.ok(text.includes(sha(original)), "the audit page carries the SHA-256 of the original");
    assert.ok(text.includes(sent.envelopeId), "and the envelope id");
    const origRead = await cap(d, "files.read", { fileId, as: "base64" });
    assert.equal(
      sha(Buffer.from(origRead.base64 as string, "base64")),
      sha(original),
      "the original is never written over",
    );
    const list = await cap(d, "files.get", { fileId: st.signedFileId });
    assert.equal(list.file.name, "Northwind services agreement (signed).pdf");
    assert.equal(list.file.folderId, (await cap(d, "files.get", { fileId })).file.folderId, "beside the original");
    assert.equal((await cap(d, "esign.list", { fileId })).envelopes[0].signedFileId, st.signedFileId);
  } finally {
    await d.stop();
  }
});

test("the same through the relay's box half: only /p/* reaches the Space, no cookie or Authorization gets in, a drawn signature and two signers in order", async () => {
  const d = await boot(seededDir());
  try {
    const original = await samplePdf(1, "Northwind data processing addendum");
    const made = await cap(d, "files.create", {
      folderId: await home(d),
      name: "Addendum.pdf",
      mime: "application/pdf",
      content: { base64: Buffer.from(original).toString("base64") },
    });
    const sent = await cap(d, "esign.send", {
      fileId: made.file.fileId,
      signers: [
        { name: "Andrea Lindahl", email: "andrea@northwind.example" },
        { name: "Sam Okafor", order: 2 },
      ],
    });
    const [a, s] = sent.links.map((l: { path: string }) => l.path) as string[];
    // the relay carries a request; the owner's Authorization it was handed is dropped, so the link is all there is
    const waiting = await relayed(d, "POST", `${s}view`, {});
    assert.equal(waiting.status, 200);
    assert.equal(JSON.parse(waiting.body.toString()).data.state, "waiting");
    assert.equal(
      (await relayed(d, "GET", `${s}doc`)).status,
      404,
      "the second signer cannot read the document before the first has signed",
    );
    const one = await relayed(d, "POST", `${a}view`, {});
    assert.equal(JSON.parse(one.body.toString()).data.state, "ready");
    assert.equal(one.headers["set-cookie"], undefined);
    assert.match(one.headers["content-security-policy"] ?? "", /sandbox allow-scripts/);
    assert.match(one.headers["content-security-policy"] ?? "", /frame-ancestors 'none'/);
    assert.equal(one.headers["cache-control"], "no-store");
    const first = await relayed(d, "POST", `${a}sign`, {
      name: "Andrea Lindahl",
      consent: true,
      signature: { kind: "drawn", png: Buffer.from(samplePng()).toString("base64") },
    });
    assert.equal(first.status, 200, first.body.toString());
    assert.equal(JSON.parse(first.body.toString()).data.completed, false);
    assert.equal((await cap(d, "esign.status", { envelopeId: sent.envelopeId })).status, "viewed");
    const second = await relayed(d, "POST", `${s}sign`, {
      name: "Sam Okafor",
      consent: true,
      signature: { kind: "typed", text: "Sam Okafor" },
    });
    assert.equal(JSON.parse(second.body.toString()).data.completed, true, second.body.toString());
    const st = await cap(d, "esign.status", { envelopeId: sent.envelopeId });
    assert.equal(st.status, "signed");
    const bytes = Buffer.from(
      (await cap(d, "files.read", { fileId: st.signedFileId, as: "base64" })).base64 as string,
      "base64",
    );
    assert.equal(sha(bytes), st.finalSha256);
    assert.match(bytes.toString("latin1"), /\/Subtype\s*\/Image/, "the drawn mark is an image on the page");
    assert.match(textOf(bytes), /Signed by Sam Okafor/);
    // the audit page names the address the relay saw
    assert.match(textOf(bytes), /203\.0\.113\.44/);
    // wrong links, through the relay and straight, are the same plain refusal
    const bad = ["x".repeat(43), "short"].map((t) => `/p/sign/${t}/view`);
    const answers = new Set<string>();
    for (const p of bad) {
      answers.add((await relayed(d, "POST", p, {})).body.toString());
      answers.add((await direct(d, "POST", p, {})).body.toString());
    }
    assert.equal(answers.size, 1);
    // nothing of the app is reachable by that path
    assert.equal((await relayed(d, "POST", "/v1/esign/list", {})).status, 400);
  } finally {
    await d.stop();
  }
});

test("declining and cancelling through the public door", async () => {
  const d = await boot(seededDir());
  try {
    const made = await cap(d, "files.create", {
      folderId: await home(d),
      name: "Lease.pdf",
      mime: "application/pdf",
      content: { base64: Buffer.from(await samplePdf(1)).toString("base64") },
    });
    const sent = await cap(d, "esign.send", {
      fileId: made.file.fileId,
      signers: [{ name: "Andrea Lindahl" }, { name: "Sam Okafor" }],
    });
    const [a, s] = sent.links.map((l: { path: string }) => l.path) as string[];
    const declined = await relayed(d, "POST", `${a}decline`, { reason: "The rent is wrong." });
    assert.deepEqual(JSON.parse(declined.body.toString()), { data: { state: "declined" } });
    assert.equal((await relayed(d, "POST", `${s}view`, {})).status, 404);
    const st = await cap(d, "esign.status", { envelopeId: sent.envelopeId });
    assert.equal(st.status, "declined");
    assert.equal(st.declinedReason, "The rent is wrong.");
    const again = await cap(d, "esign.send", { fileId: made.file.fileId, signers: [{ name: "Andrea Lindahl" }] });
    await cap(d, "esign.cancel", { envelopeId: again.envelopeId });
    assert.equal((await direct(d, "POST", `${again.links[0].path}view`, {})).status, 404);
  } finally {
    await d.stop();
  }
});

test("Dropbox Sign built from the Vault on a booted Space: a key in the Vault is enough for a send to reach the service, and the service's own mail is what the signer gets", async () => {
  const items = new Map<string, string>();
  const seen: { method: string; url: string; auth: string | undefined }[] = [];
  const fetch: SeamFetch = async (url, init) => {
    seen.push({ method: init?.method ?? "GET", url, auth: init?.headers?.["Authorization"] });
    const body = url.endsWith("/signature_request/send")
      ? { signature_request: { signature_request_id: "sr_live_1" } }
      : {};
    return { status: 200, text: async () => JSON.stringify(body), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const vault = {
    secret: async (handle: string) => {
      const v = items.get(handle);
      if (v === undefined) throw new Error("no such Vault item");
      return v;
    },
    signRs256: async () => "",
  };
  const d = await boot(seededDir(), { vault, seams: { fetch } });
  try {
    const dropbox = (): Promise<{ connected: boolean }> =>
      cap(d, "esign.providers").then((r) => r.providers.find((p: { key: string }) => p.key === "dropbox_sign"));
    assert.equal((await dropbox()).connected, false);
    const made = await cap(d, "files.create", {
      folderId: await home(d),
      name: "NDA.pdf",
      mime: "application/pdf",
      content: { base64: Buffer.from(await samplePdf(1)).toString("base64") },
    });
    const input = {
      fileId: made.file.fileId,
      provider: "dropbox_sign",
      signers: [{ name: "Andrea Lindahl", email: "andrea@northwind.example" }],
    };
    const refused = await fetchRaw(d, "esign.send", input);
    assert.equal(refused.status, 422, "no key, no send");
    assert.equal(seen.length, 0);
    items.set("#Dropbox_Sign.apiKey", "db_live_key_0123456789");
    assert.equal((await dropbox()).connected, true);
    const sent = await cap(d, "esign.send", input);
    assert.match(sent.envelopeId, /^env_/);
    assert.equal(sent.links, undefined);
    const call = seen.find((s) => s.url.endsWith("/signature_request/send"));
    assert.equal(call?.auth, `Basic ${Buffer.from("db_live_key_0123456789:").toString("base64")}`);
    assert.equal((await cap(d, "esign.list", {})).envelopes[0].provider, "dropbox_sign");
    items.delete("#Dropbox_Sign.apiKey");
    assert.equal((await dropbox()).connected, false, "taking the key out takes effect at the next call");
  } finally {
    await d.stop();
  }
});

async function fetchRaw(
  d: Daemon,
  name: string,
  body: Record<string, unknown>,
): Promise<{ status: number; text: string }> {
  const r = await fetch(`${d.url}/v1/${name.replaceAll(".", "/")}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` },
    body: JSON.stringify({ idempotencyKey: `sign-live-${++n}`, ...body }),
  });
  return { status: r.status, text: await r.text() };
}

/** Every file under a folder, as bytes. */
function filesUnder(dir: string): { file: string; bytes: Buffer }[] {
  const out: { file: string; bytes: Buffer }[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(f));
    else if (e.isFile()) out.push({ file: f, bytes: fs.readFileSync(f) });
  }
  return out;
}

test("the finished file carries a real PDF digital signature: esign.verify says sealed and intact, openssl independently agrees, a changed byte fails both, and the Space's private key is in no file in the clear", async () => {
  const dir = seededDir();
  const d = await boot(dir);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-seal-check-"));
  try {
    const original = await samplePdf(2, "Northwind services agreement");
    const folder = await home(d);
    const made = await cap(d, "files.create", {
      folderId: folder,
      name: "Seal check.pdf",
      mime: "application/pdf",
      content: { base64: Buffer.from(original).toString("base64") },
    });
    const sent = await cap(d, "esign.send", {
      fileId: made.file.fileId,
      signers: [{ name: "Andrea Lindahl", email: "andrea@northwind.example" }],
    });
    const link = sent.links[0].path as string;
    const done = await relayed(d, "POST", `${link}sign`, {
      name: "Andrea Lindahl",
      consent: true,
      signature: { kind: "typed", text: "Andrea Lindahl" },
    });
    assert.equal(done.status, 200, done.body.toString());
    const st = await cap(d, "esign.status", { envelopeId: sent.envelopeId });
    assert.equal(st.sealed, true);
    assert.match(st.sealFingerprint, /^[0-9a-f]{64}$/);
    const file = Buffer.from(
      (await cap(d, "files.read", { fileId: st.signedFileId, as: "base64" })).base64 as string,
      "base64",
    );
    const copy = await relayed(d, "POST", `${link}copy`, {});
    assert.deepEqual(copy.body, file, "the signer's own copy is the same sealed file");

    // our own check
    const v = await cap(d, "esign.verify", { fileId: st.signedFileId });
    assert.deepEqual([v.sealed, v.intact, v.bySpace, v.fingerprint], [true, true, true, st.sealFingerprint]);
    assert.match(textOf(file), /Sealed by .* with a certificate made by this Space\. Fingerprint SHA-256:/);

    // an independent check that uses none of our code: the byte ranges and the CMS blob, handed to openssl
    const text = file.toString("latin1");
    const br = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(text)!;
    const [a, b, c, e] = [1, 2, 3, 4].map((i) => Number(br[i]));
    const openssl = (bytes: Buffer, name: string): { ok: boolean; text: string } => {
      const content = Buffer.concat([bytes.subarray(a, a + b), bytes.subarray(c, c + e)]);
      const hex = bytes.toString("latin1", b + 1, c - 1).replace(/0+$/, "");
      const sig = Buffer.from(hex.length % 2 ? `${hex}0` : hex, "hex");
      fs.writeFileSync(path.join(tmp, `${name}.bin`), content);
      fs.writeFileSync(path.join(tmp, `${name}.der`), sig);
      const r = spawnSync(
        "openssl",
        [
          "cms",
          "-verify",
          "-binary",
          "-inform",
          "DER",
          "-in",
          path.join(tmp, `${name}.der`),
          "-content",
          path.join(tmp, `${name}.bin`),
          "-noverify",
          "-out",
          "/dev/null",
        ],
        { encoding: "utf8" },
      );
      return { ok: r.status === 0, text: `${r.stdout}${r.stderr}` };
    };
    assert.ok(a === 0 && c + e === file.length, "the ranges cover the whole file but the signature");
    const good = openssl(file, "good");
    assert.ok(good.ok, `openssl verifies the real file: ${good.text}`);
    const tampered = Buffer.from(file);
    tampered[Math.floor(b / 2)] = (tampered[Math.floor(b / 2)] as number) ^ 1;
    assert.equal(openssl(tampered, "bad").ok, false, "openssl refuses a changed byte");
    fs.writeFileSync(path.join(tmp, "tampered.pdf"), tampered);
    const tamperedId = (
      await cap(d, "files.create", {
        folderId: folder,
        name: "Tampered.pdf",
        mime: "application/pdf",
        content: { base64: tampered.toString("base64") },
      })
    ).file.fileId;
    const t = await cap(d, "esign.verify", { fileId: tamperedId });
    assert.deepEqual([t.sealed, t.intact], [true, false], "and so does esign.verify");

    // the private key is in no file of the data directory in the clear, and in no log
    const rsaPrivate = Buffer.from("020100300d06092a864886f70d01010105000482", "hex"); // the start of an RSA PKCS#8 private key: version 0, the RSA algorithm, the key octets
    const row = d.db!.all("SELECT sealed_key FROM esign_seal WHERE slot = 'current'")[0] as { sealed_key: string };
    assert.match(row.sealed_key, /keyId/, "kept as the server's own sealing, not as key bytes");
    for (const { file: f, bytes } of filesUnder(dir)) {
      assert.ok(!bytes.includes("PRIVATE KEY"), `no PEM key in ${f}`);
      assert.ok(!bytes.includes(rsaPrivate), `no PKCS#8 key in ${f}`);
    }
  } finally {
    await d.stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
