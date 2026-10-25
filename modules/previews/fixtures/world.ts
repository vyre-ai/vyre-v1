// A hand-built Ctx for the previews tests: MemoryDb over the real migration, a fake files module (files.get, files.read in chunks, files.versions) and a fake Exec that plays pdftoppm, pdftotext,
// soffice and vipsthumbnail the way those programs behave (arguments read, output files written), with switches to take any of them away.

import fs from "node:fs";
import path from "node:path";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { BlobMeta, Blobs, Ctx, Decision } from "../../../packages/contracts/src/ctx.ts";
import type { EventEnvelope } from "../../../packages/contracts/src/envelope.ts";
import type { EventName } from "../../../packages/contracts/src/types.ts";
import { configurePreviews, decodePng, encodePng, probeImage } from "../handlers/render.ts";
import type { Exec, ExecResult } from "../handlers/render.ts";
import { MemoryDb } from "./db.ts";
import { pdf, solid } from "./make.ts";

export const NOW = 1_760_000_000_000;
export const TRACE = "0123456789abcdef0123456789abcdef";

type Row = Record<string, unknown>;
export interface Emitted { name: string; subject: string; payload: unknown }
export interface ExecCall { argv: string[]; env?: Record<string, string> | undefined }

export function vyreErr(code: string, message: string): VyreErr {
  return new VyreErr({ code: code as never, message, retryable: false, traceId: TRACE, next: [{ kind: "report", label: "Report a problem" }] });
}

export interface FakeVersion { versionId: string; n: number; bytes: Uint8Array }
export interface FakeFile { fileId: string; name: string; mime: string; versions: FakeVersion[]; /** report this size instead of the bytes' length */ size?: number }

export class FakeFiles {
  readonly files = new Map<string, FakeFile>();
  readonly reads: { fileId: string; versionId?: string; offset: number; length: number }[] = [];
  readonly getCalls: string[] = [];
  private seq = 0;

  add(name: string, mime: string, bytes: Uint8Array, fileId?: string): FakeFile {
    this.seq += 1;
    const id = fileId ?? `fil_p${this.seq}`;
    const f: FakeFile = { fileId: id, name, mime, versions: [{ versionId: `ver_${id.slice(4)}v1`, n: 1, bytes }] };
    this.files.set(id, f);
    return f;
  }

  /** A new version of a file; returns it. */
  edit(fileId: string, bytes: Uint8Array): FakeVersion {
    const f = this.mustHave(fileId);
    const n = f.versions.length + 1;
    const v = { versionId: `ver_${fileId.slice(4)}v${n}`, n, bytes };
    f.versions.push(v);
    return v;
  }

  private mustHave(fileId: string): FakeFile {
    const f = this.files.get(fileId);
    if (!f) throw vyreErr("validation.not_found", "No such file.");
    return f;
  }

  call(cap: string, i: Row): unknown {
    if (cap === "files.get") {
      const f = this.mustHave(String(i["fileId"]));
      this.getCalls.push(f.fileId);
      const cur = f.versions[f.versions.length - 1] as FakeVersion;
      return { file: { fileId: f.fileId, name: f.name, mime: f.mime, size: f.size ?? cur.bytes.length, version: cur.n } };
    }
    if (cap === "files.versions") {
      const f = this.mustHave(String(i["fileId"]));
      return { versions: [...f.versions].reverse().map((v) => ({ versionId: v.versionId, n: v.n, by: "usr_owner", at: NOW })) };
    }
    if (cap === "files.read") {
      const f = this.mustHave(String(i["fileId"]));
      const v = typeof i["versionId"] === "string" ? f.versions.find((x) => x.versionId === i["versionId"]) : f.versions[f.versions.length - 1];
      if (!v) throw vyreErr("validation.not_found", "That version is not on this file.");
      const offset = typeof i["offset"] === "number" ? i["offset"] : 0;
      const length = typeof i["length"] === "number" ? i["length"] : v.bytes.length;
      this.reads.push({ fileId: f.fileId, ...(typeof i["versionId"] === "string" ? { versionId: i["versionId"] } : {}), offset, length });
      const slice = v.bytes.subarray(offset, Math.min(v.bytes.length, offset + length));
      return { base64: Buffer.from(slice).toString("base64"), mime: f.mime, size: f.size ?? v.bytes.length, version: v.n, truncated: offset > 0 || offset + length < v.bytes.length };
    }
    return undefined;
  }
}

/** A blob store with the contract of ctx.blobs: content types and sizes kept, a missing id absent, delete reported, another module's id refused (`foreign` ids stand for those). */
export class FakeBlobs implements Blobs {
  readonly items = new Map<string, { meta: BlobMeta; bytes: Uint8Array }>();
  readonly foreign = new Set<string>();
  puts = 0;
  deletes: string[] = [];
  /** make put fail with this code once (quota, size) */
  failPut: string | undefined;
  private seq = 0;

  async put(bytes: Uint8Array, contentType: string): Promise<BlobMeta> {
    if (this.failPut) { const code = this.failPut; this.failPut = undefined; throw vyreErr(code, "The blob store refused this blob."); }
    this.puts += 1;
    this.seq += 1;
    const id = `blb_${this.seq.toString(16).padStart(32, "0")}`;
    const meta: BlobMeta = { id, contentType, size: bytes.byteLength, sha256: "0".repeat(64), createdAt: NOW };
    this.items.set(id, { meta, bytes: new Uint8Array(bytes) });
    return meta;
  }
  private own(id: string): void {
    if (this.foreign.has(id)) throw vyreErr("permission.no_grant", "A module may only use its own blobs.");
  }
  async get(id: string) { this.own(id); return this.items.get(id) ?? null; }
  async stat(id: string) { this.own(id); return this.items.get(id)?.meta ?? null; }
  async delete(id: string): Promise<boolean> { this.own(id); this.deletes.push(id); return this.items.delete(id); }
}

export interface Tools { pdftoppm: boolean; pdftotext: boolean; soffice: boolean; vips: boolean }

export function harness() {
  const db = new MemoryDb();
  const files = new FakeFiles();
  const blobs = new FakeBlobs();
  const events: Emitted[] = [];
  const calls: { cap: string; input: unknown }[] = [];
  const execCalls: ExecCall[] = [];
  const tools: Tools = { pdftoppm: true, pdftotext: false, soffice: true, vips: true };
  /** what pdftotext prints (form feeds between pages) */
  const text = { pdf: "" };
  /** what soffice produces from any document */
  const converted = { pdf: pdf([["Converted page one"], ["Converted page two"], ["Converted page three"]]) };
  const failures = new Map<string, ExecResult>();
  let clock = NOW;

  const missing: ExecResult = { code: 127, stdout: "", stderr: "not found" };
  const exec: Exec = async (argv, opts) => {
    execCalls.push({ argv: [...argv], env: opts?.env });
    const prog = path.basename(argv[0] ?? "");
    const fail = failures.get(prog);
    if (fail) return fail;
    if (prog === "pdftoppm") {
      if (!tools.pdftoppm) return missing;
      if (argv[1] === "-v") return { code: 0, stdout: "", stderr: "pdftoppm version 24.02" };
      const at = (flag: string): string => argv[argv.indexOf(flag) + 1] ?? "";
      const input = argv[argv.length - 2] as string;
      const prefix = argv[argv.length - 1] as string;
      const head = Buffer.from(fs.readFileSync(input)).subarray(0, 4).toString("latin1");
      if (head !== "%PDF") return { code: 1, stdout: "", stderr: "Syntax Error: not a PDF" };
      const width = Number(at("-scale-to-x"));
      const page = Number(at("-f"));
      fs.writeFileSync(`${prefix}.png`, encodePng(solid(width, Math.round(width * 1.414), [page * 40 % 256, 90, 160, 255])));
      return { code: 0, stdout: "", stderr: "" };
    }
    if (prog === "pdftotext") {
      if (!tools.pdftotext) return missing;
      if (argv[1] === "-v") return { code: 0, stdout: "", stderr: "pdftotext version 24.02" };
      return { code: 0, stdout: text.pdf, stderr: "" };
    }
    if (prog === "soffice") {
      if (!tools.soffice) return missing;
      if (argv[1] === "--version") return { code: 0, stdout: "LibreOffice 24.2", stderr: "" };
      const outdir = argv[argv.indexOf("--outdir") + 1] as string;
      const input = argv[argv.length - 1] as string;
      fs.writeFileSync(path.join(outdir, `${path.basename(input).replace(/\.[^.]*$/, "")}.pdf`), converted.pdf);
      return { code: 0, stdout: "", stderr: "" };
    }
    if (prog === "vipsthumbnail") {
      if (!tools.vips) return missing;
      if (argv[1] === "--version") return { code: 0, stdout: "vips-8.15", stderr: "" };
      const input = argv[1] as string;
      const size = String(argv[argv.indexOf("-s") + 1]);
      const out = argv[argv.indexOf("-o") + 1] as string;
      const bytes = new Uint8Array(fs.readFileSync(input));
      const dim = probeImage(bytes);
      if (!dim) return { code: 1, stdout: "", stderr: "VipsForeignLoad: not a known file format" };
      const wanted = Number(size.split("x")[0]);
      const w = Math.min(wanted, dim.width);
      const h = Math.max(1, Math.round((dim.height * w) / dim.width));
      fs.writeFileSync(out, encodePng(solid(w, h, [20, 120, 60, 255])));
      return { code: 0, stdout: "", stderr: "" };
    }
    return missing;
  };
  configurePreviews({ exec });

  const ctx: Ctx = {
    space: "spc_test",
    principal: { kind: "person", id: "usr_owner" },
    trace: { traceId: TRACE, spanId: "0123456789abcdef" },
    origin: "ui",
    depth: 0,
    now: () => clock,
    db,
    emit<T>(name: EventName, subject: string, payload: T): EventEnvelope<T> {
      events.push({ name, subject, payload });
      return {} as EventEnvelope<T>;
    },
    async call(cap, input) {
      calls.push({ cap, input });
      const r = files.call(cap, input !== null && typeof input === "object" ? (input as Row) : {});
      if (r !== undefined) return r;
      throw new Error(`unscripted call ${cap}`);
    },
    authorize(): Decision {
      return { effect: "allow", reason: "granted", decisionId: "dec_test" };
    },
    vault: { async fill() {}, use: (handle) => ({ handle }) },
    http: async () => ({ status: 200, text: async () => "" }),
    log: { debug() {}, info() {}, warn() {}, error() {} },
    schedule: async () => "sch_1",
    seal: { seal: () => ({ keyId: "k", nonce: "n", bytes: "b" }), unseal: () => new Uint8Array() },
    blobs,
  };

  return {
    ctx, db, files, blobs, events, calls, execCalls, tools, text, converted, failures,
    advance(ms: number) { clock += ms; },
    named(name: string): unknown[] { return events.filter((e) => e.name === name).map((e) => e.payload); },
    ran(prog: string): ExecCall[] { return execCalls.filter((c) => path.basename(c.argv[0] ?? "") === prog); },
    rows(table: string): Row[] { return db.rows(table) as Row[]; },
    cleanup() { configurePreviews(null); },
  };
}

export type World = ReturnType<typeof harness>;

/** The blob a reference returned by the module points at: its bytes and metadata. Fails when the reference is not `/spaces/<space>/blobs/<id>` or names no stored blob. */
export function blobOf(w: { blobs: FakeBlobs; ctx: Ctx }, url: string): { meta: BlobMeta; bytes: Uint8Array } {
  const prefix = `/spaces/${w.ctx.space}/blobs/`;
  if (!url.startsWith(prefix)) throw new Error(`not a blob reference: ${url.slice(0, 40)}`);
  const hit = w.blobs.items.get(url.slice(prefix.length));
  if (!hit) throw new Error(`no stored blob for ${url}`);
  return hit;
}

/** Width and height of the png a blob reference points at. */
export function dimsOf(w: { blobs: FakeBlobs; ctx: Ctx }, url: string): { width: number; height: number } {
  const r = decodePng(blobOf(w, url).bytes);
  if (!r) throw new Error("not a decodable png");
  return { width: r.width, height: r.height };
}
