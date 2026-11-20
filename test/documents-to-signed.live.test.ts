// Documents to a signature, end to end on a booted fresh Space (lane r42-docs, 19 Nov 2026). Nothing installed, no provider account, no mailbox. Imran Ibarra (the Space's owner) keeps a service agreement
// as a Vyre document and as a Word file, fills each from values, sends the PDF to Andrea Lindahl and Sam Okafor at northwind.example, they sign with no account, and the signed file lands beside the
// PDF. The Vyre document says where each signer signs ({sign:client}, {sign:firm}); the Word file gets a signature page. Nothing is sent to a real address: the people and domain are invented.
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
import { textOf } from "../modules/esign/fixtures/pdf.ts";
import { docx, para } from "../modules/documents/fixtures/world.ts";

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


const AGREEMENT = `# Service agreement

This agreement is between {firm.name} and {client.name}, dated {signing_date}.

The fee is {matter.fee}.

{sign:client} {date:client} || {sign:firm} {date:firm}
`;
const VALUES = { firm: { name: "Northwind Traders" }, client: { name: "Andrea Lindahl" }, matter: { fee: 1500 } };
const b64 = (b: Uint8Array | string): string => Buffer.from(b).toString("base64");

test("a Vyre document goes from template to signed PDF on a fresh Space: filled with no converter, signed in the places its text names, and the signed copy lands beside it", async () => {
  const d = await boot(seededDir());
  try {
    const folderId = await home(d);
    const tpl = await cap(d, "files.create", { folderId, name: "Service agreement.md", mime: "text/markdown", content: { base64: b64(AGREEMENT) } });
    const templateFileId = tpl.file.fileId as string;
    await cap(d, "documents.mark_template", { fileId: templateFileId, isTemplate: true });
    const listed = await cap(d, "documents.templates.list", {});
    assert.ok(listed.templates.some((t: { fileId: string }) => t.fileId === templateFileId));
    const fields = await cap(d, "documents.fields", { templateFileId });
    assert.deepEqual(fields.signers, ["client", "firm"]);

    // a blank missing stops it and makes nothing
    const refused = await fetch(`${d.url}/v1/documents/fill`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` },
      body: JSON.stringify({ idempotencyKey: "doc-miss", templateFileId, intoFolderId: folderId, values: { firm: VALUES.firm }, signingDate: "2026-11-19" }),
    });
    assert.notEqual(refused.status, 200);
    assert.match(await refused.text(), /client\.name/);

    const filled = await cap(d, "documents.fill", { templateFileId, intoFolderId: folderId, values: VALUES, signingDate: "2026-11-19", name: "Service agreement - Lindahl" });
    assert.deepEqual(filled.missing, []);
    assert.deepEqual(filled.signers, ["client", "firm"]);
    const pdfId = filled.file.fileId as string;
    const where = await cap(d, "documents.signing", { fileId: pdfId });
    assert.equal(where.places.length, 4, "a signature and a date for each of two signers");

    const sent = await cap(d, "esign.send", {
      fileId: pdfId,
      signers: [
        { name: "Andrea Lindahl", email: "andrea@northwind.example" },
        { name: "Sam Okafor", email: "sam@northwind.example", order: 2 },
      ],
    });
    const [a, s] = sent.links.map((l: { path: string }) => l.path) as string[];
    const first = JSON.parse((await direct(d, "POST", `${a}view`, {})).body.toString()).data;
    assert.equal(first.state, "ready");
    assert.equal(first.places.length, 2, "Andrea sees her own signature and date, where the text said");
    const sentDoc = await direct(d, "GET", `${a}doc`);
    assert.doesNotMatch(textOf(sentDoc.body), /Signature page/, "no extra signature page: the document had its own places");
    const read = textOf(sentDoc.body).replace(/\s+/g, " ");
    assert.match(read, /Northwind Traders and Andrea Lindahl/);
    assert.match(read, /1,?500/);

    const one = await direct(d, "POST", `${a}sign`, { name: "Andrea Lindahl", consent: true, signature: { kind: "typed", text: "Andrea Lindahl" } });
    assert.equal(JSON.parse(one.body.toString()).data.completed, false, one.body.toString());
    const two = await direct(d, "POST", `${s}sign`, { name: "Sam Okafor", consent: true, signature: { kind: "typed", text: "Sam Okafor" } });
    assert.equal(JSON.parse(two.body.toString()).data.completed, true, two.body.toString());

    const st = await cap(d, "esign.status", { envelopeId: sent.envelopeId });
    assert.equal(st.status, "signed");
    const final = Buffer.from((await cap(d, "files.read", { fileId: st.signedFileId, as: "base64" })).base64 as string, "base64");
    assert.equal(sha(final), st.finalSha256);
    assert.match(textOf(final), /Signed by Andrea Lindahl/);
    assert.match(textOf(final), /Signed by Sam Okafor/);
    const got = await cap(d, "files.get", { fileId: st.signedFileId });
    assert.equal(got.file.folderId, folderId, "beside the PDF it was made from");
    // the template and the filled PDF are untouched
    const tplRead = await cap(d, "files.read", { fileId: templateFileId, as: "base64" });
    assert.equal(Buffer.from(tplRead.base64 as string, "base64").toString("utf8"), AGREEMENT);
    // the same fill again is the same file, not a second one (a retry never doubles)
    const again = await cap(d, "documents.fill", { templateFileId, intoFolderId: folderId, values: VALUES, signingDate: "2026-11-19", name: "Service agreement - Lindahl", idempotencyKey: "doc-retry-1" });
    const again2 = await cap(d, "documents.fill", { templateFileId, intoFolderId: folderId, values: VALUES, signingDate: "2026-11-19", name: "Service agreement - Lindahl", idempotencyKey: "doc-retry-1" });
    assert.equal(again.file.fileId, again2.file.fileId);
  } finally {
    await d.stop();
  }
});

test("a Word template goes from template to signed PDF on a fresh Space: the PDF is made with or without the server's converter, and a single signer signs the signature page", async () => {
  const d = await boot(seededDir());
  try {
    const folderId = await home(d);
    const word = docx(para("Service agreement between {firm} and ", "{client}."));
    const tpl = await cap(d, "files.create", {
      folderId,
      name: "Agreement.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      content: { base64: b64(word) },
    });
    const templateFileId = tpl.file.fileId as string;
    const filled = await cap(d, "documents.fill", { templateFileId, intoFolderId: folderId, values: { firm: "Northwind Traders", client: "Andrea Lindahl" }, format: "pdf" });
    assert.ok(["word", "simple"].includes(filled.layout), `layout ${filled.layout}`);
    assert.match(filled.file.name, /\.pdf$/);
    const who = [{ name: "Andrea Lindahl", email: "andrea@northwind.example" }];
    if (filled.layout === "simple") {
      // the plain copy has no letterhead: it is held until the sender says send it anyway
      await assert.rejects(cap(d, "esign.send", { fileId: filled.file.fileId, signers: who }), /Letterhead and pictures are missing in this copy/);
    }
    if (filled.layout === "simple") {
      // the mark follows the bytes: the same bytes uploaded again as another file are held too
      const bytes = (await cap(d, "files.read", { fileId: filled.file.fileId, as: "base64" })).base64 as string;
      const again = await cap(d, "files.create", { folderId, name: "Re-uploaded agreement.pdf", mime: "application/pdf", content: { base64: bytes } });
      await assert.rejects(cap(d, "esign.send", { fileId: again.file.fileId, signers: who }), /Letterhead and pictures are missing in this copy/);
    }
    const sent = await cap(d, "esign.send", { fileId: filled.file.fileId, signers: who, ...(filled.layout === "simple" ? { plainOk: true } : {}) });
    const link = sent.links[0].path as string;
    const doc = await direct(d, "GET", `${link}doc`);
    assert.match(doc.body.subarray(0, 5).toString("latin1"), /%PDF-/);
    const done = await direct(d, "POST", `${link}sign`, { name: "Andrea Lindahl", consent: true, signature: { kind: "typed", text: "Andrea Lindahl" } });
    assert.equal(JSON.parse(done.body.toString()).data.completed, true, done.body.toString());
    const st = await cap(d, "esign.status", { envelopeId: sent.envelopeId });
    assert.equal(st.status, "signed");
    const final = Buffer.from((await cap(d, "files.read", { fileId: st.signedFileId, as: "base64" })).base64 as string, "base64");
    assert.match(textOf(final), /Signed by Andrea Lindahl/);
    // an agent or person cannot sign a Word file: it must be a PDF first
    await assert.rejects(
      cap(d, "esign.send", { fileId: templateFileId, signers: [{ name: "Andrea Lindahl" }] }),
      /Word|PDF/,
    );
  } finally {
    await d.stop();
  }
});
