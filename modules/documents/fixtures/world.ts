// A hand-built Ctx for the documents tests: a fake files service behind ctx.call (get, read, create, versions), fake records, a tiny database for the template marks,
// a Word file built in code (no binary fixture) and a clock that ticks. Nothing here touches the host.

import { createRequire } from "node:module";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { EventEnvelope } from "../../../packages/contracts/src/envelope.ts";

type Row = Record<string, unknown>;

export const MIGRATION = new URL("../migrations/0001_documents.sql", import.meta.url);
export const FOLDER = "fld_main";
export const OTHER_FOLDER = "fld_other";
export const TRACE = "0123456789abcdef0123456789abcdef";

// ---- a Word file built in code ----

interface ZipApi {
  file(name: string, data: string): unknown;
  file(name: string): { asText(): string } | null;
  files: Record<string, unknown>;
  generate(o: { type: "nodebuffer" }): Buffer;
}
const need = createRequire(import.meta.url);
const Zip = need("pizzip") as new (data?: Uint8Array) => ZipApi;

const NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** A minimal valid .docx whose body is the given WordprocessingML; `extra` adds more parts (styles, headers). */
export function docx(body: string, extra: Record<string, string> = {}): Buffer {
  const z = new Zip();
  z.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  z.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${NS}"><w:body>${body}</w:body></w:document>`);
  for (const [name, xml] of Object.entries(extra)) z.file(name, xml);
  return z.generate({ type: "nodebuffer" });
}

/** One paragraph; each string is one run, so a test can split a placeholder across runs the way Word does. */
export const para = (...runs: string[]): string => `<w:p>${runs.map((r) => `<w:r><w:t xml:space="preserve">${r}</w:t></w:r>`).join("")}</w:p>`;

/** The paragraphs of a .docx as plain text. */
export function textOf(buf: Uint8Array): string[] {
  const xml = String(new Zip(buf).file("word/document.xml")?.asText() ?? "");
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => m[0].replace(/<[^>]+>/g, ""));
}

export const partOf = (buf: Uint8Array, name: string): string | undefined => new Zip(buf).file(name)?.asText();
export const partNames = (buf: Uint8Array): string[] => Object.keys(new Zip(buf).files).sort();

// ---- the world ----

export interface Stored { id: string; name: string; folderId: string; bytes: Buffer; mime: string; versions: number; deleted?: boolean }

export interface World {
  ctx: Ctx;
  events: { name: string; subject: string; payload: unknown }[];
  files: Map<string, Stored>;
  records: Map<string, Record<string, unknown>>;
  /** file ids the caller may not open: ctx.authorize denies and files.get/read answer not found */
  denied: Set<string>;
  calls: { cap: string; input: Record<string, unknown> }[];
  add(name: string, bytes: Buffer, folderId?: string, fileId?: string): string;
  /** the marked templates, straight from the table */
  marks(): Row[];
}

function err(code: "validation.duplicate" | "validation.not_found", message: string): VyreErr {
  return new VyreErr({ code, message, retryable: false, traceId: TRACE, next: [] });
}

function memoryDb(): Ctx["db"] & { rows: Row[] } {
  const rows: Row[] = [];
  return {
    rows,
    all(sql: string, ...args: unknown[]): unknown[] {
      if (sql === "SELECT * FROM documents_template") return rows.map((r) => ({ ...r }));
      if (sql === "SELECT * FROM documents_template WHERE file_id = ?") return rows.filter((r) => r.file_id === args[0]).map((r) => ({ ...r }));
      throw new Error(`unsupported query: ${sql}`);
    },
    run(sql: string, ...args: unknown[]): { changes: number } {
      if (sql === "INSERT INTO documents_template (file_id, marked_by, marked_at) VALUES (?, ?, ?)") {
        rows.push({ file_id: args[0], marked_by: args[1], marked_at: args[2] });
        return { changes: 1 };
      }
      if (sql === "DELETE FROM documents_template WHERE file_id = ?") {
        const before = rows.length;
        const kept = rows.filter((r) => r.file_id !== args[0]);
        rows.length = 0;
        rows.push(...kept);
        return { changes: before - kept.length };
      }
      throw new Error(`unsupported statement: ${sql}`);
    },
  };
}

export function world(): World {
  const db = memoryDb();
  const files = new Map<string, Stored>();
  const records = new Map<string, Record<string, unknown>>();
  const denied = new Set<string>();
  const events: World["events"] = [];
  const calls: World["calls"] = [];
  let clock = 1_760_000_000_000;
  let n = 0;
  const row = (f: Stored): Row => ({ fileId: f.id, folderId: f.folderId, name: f.name, mime: f.mime, size: f.bytes.length, version: f.versions, kind: "document", updatedAt: clock });
  const need_ = (id: unknown): Stored => {
    const f = typeof id === "string" ? files.get(id) : undefined;
    if (!f || f.deleted || denied.has(f.id)) throw err("validation.not_found", "That file does not exist.");
    return f;
  };
  const ctx: Ctx = {
    space: "spc_test",
    principal: { kind: "person", id: "per_dana" },
    trace: { traceId: TRACE, spanId: "b".repeat(16) },
    origin: "user",
    depth: 0,
    now: () => {
      clock += 1;
      return clock;
    },
    db,
    emit: <T>(name: string, subject: string, payload: T): EventEnvelope<T> => {
      events.push({ name, subject, payload });
      return {
        seq: events.length, id: `evt_${events.length}`, type: name, sv: 1, hlc: String(clock), at: clock, traceId: TRACE, actor: "per_dana", depth: 0, label: 0, vis: "space", enc: 0, payload,
      };
    },
    call: async (cap: string, input: unknown): Promise<unknown> => {
      const i = (input ?? {}) as Record<string, unknown>;
      calls.push({ cap, input: i });
      switch (cap) {
        case "files.get": return { file: row(need_(i.fileId)) };
        case "files.read": {
          const f = need_(i.fileId);
          return { base64: f.bytes.toString("base64"), mime: f.mime, size: f.bytes.length, version: f.versions, truncated: false };
        }
        case "files.create": {
          const name = String(i.name);
          const folderId = String(i.folderId);
          for (const f of files.values()) if (!f.deleted && f.folderId === folderId && f.name === name) throw err("validation.duplicate", "That name is already in this folder.");
          const content = i.content as { base64?: string };
          const id = `fil_${++n}`;
          const stored: Stored = { id, name, folderId, bytes: Buffer.from(content.base64 ?? "", "base64"), mime: String(i.mime ?? "application/octet-stream"), versions: 1 };
          files.set(id, stored);
          return { file: row(stored) };
        }
        case "files.versions": {
          const f = need_(i.fileId);
          return { versions: Array.from({ length: f.versions }, (_, k) => ({ versionId: `ver_f${f.id.replace(/\D/g, "")}n${k + 1}`, n: k + 1 })) };
        }
        case "records.get": {
          const fields = records.get(String(i.recordId));
          if (!fields) throw err("validation.not_found", "That record does not exist.");
          return { record: { id: i.recordId, type: i.type ?? "contact", fields } };
        }
        default: throw new Error(`unexpected call ${cap}`);
      }
    },
    authorize: (_action, resource) => (resource.id !== null && denied.has(resource.id)
      ? { effect: "deny", reason: "test", decisionId: "dec_deny" }
      : { effect: "allow", reason: "test", decisionId: "dec_test" }),
    vault: { fill: async () => {}, use: (handle: string) => ({ handle }) },
    http: async () => ({ status: 0, text: async () => "" }),
    log: { debug() {}, info() {}, warn() {}, error() {} },
    schedule: async () => "sch_test",
    seal: { seal: () => { throw new Error("seal is not used"); }, unseal: () => { throw new Error("seal is not used"); } },
  };
  return {
    ctx, events, files, records, denied, calls,
    add(name: string, bytes: Buffer, folderId = FOLDER, fileId?: string): string {
      const id = fileId ?? `fil_${++n}`;
      files.set(id, { id, name, folderId, bytes, mime: "application/octet-stream", versions: 1 });
      return id;
    },
    marks: () => db.rows.map((r) => ({ ...r })),
  };
}
