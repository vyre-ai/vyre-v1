// A sync pull on a booted daemon (the real Vault, the real Records, the real relation linker, the real capability pipeline): a sealed value from the app is in no byte the server writes, an unclaimed Space
// whose Vault was never unlocked still seals or waits, and one id pointer that can point at three kinds of record links each row to exactly one target.
// Only the app is a stand-in (the connector network port). Every `*.db` with its WAL, every other file of the data directory and the process's stdout and stderr are scanned for the secret.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { boot, call, hostLog, ok, seededDir, stop, waitFor } from "./eco-live.ts";
import type { Daemon } from "../../host/src/daemon/daemon.ts";

export const DASHED = "123-45-6789";
export const DIGITS = "123456789";
export const SPACED = "123 45 6789";
export const APP_KEY = "crm-live-key-0001"; // secret-scan: fake
export const DOMAIN = "api.crmapp.example";

/** The app: people carry the secret in the firm's four places; notes point at three kinds of record by one id pointer, and the three kinds share one number range. */
export interface AppOptions {
  /** This many more people, after the two, with no secret (a pull of thousands). */
  bulk?: number;
  /** The Nth list request for people fails once: with a 500, or by dropping the connection. */
  failOnce?: { at: number; mode: "500" | "drop" };
  /** `times` requests for this path, after the first `skip` ones, never get an answer (the field fault of 17 Nov: a call that hangs and never fails). */
  hang?: { path: string; times: number; skip?: number };
}
export function app(seen: { keys: string[]; urls: string[] }, opts: AppOptions = {}) {
  let peopleRequests = 0;
  let failed = false;
  let hung = 0;
  let hangSeen = 0;
  const people = [
    { id: 1, name: "Imran Ibarra", ssn: DASHED },
    { id: 2, name: "Andrea Lindahl", ssn: "" },
  ].map((p) => ({
    id: p.id,
    attributes: {
      name: p.name,
      social_security: p.ssn,
      custom_field_values: { "77": { id: 77, value: p.ssn.replaceAll("-", ""), formatted_value: p.ssn } },
      custom_fields: [
        {
          id: 77,
          name: "Social Security",
          field_type: "text",
          value: p.ssn.replaceAll("-", ""),
          formatted_value: p.ssn,
        },
        { id: 78, name: "Nickname", field_type: "text", value: `nick ${p.id}`, formatted_value: `nick ${p.id}` },
      ],
    },
  }));
  for (let i = 0; i < (opts.bulk ?? 0); i++)
    people.push({
      id: 1000 + i,
      attributes: { name: `Bulk ${i}`, social_security: "", custom_field_values: {}, custom_fields: [] },
    } as never);
  const named = (kind: string) =>
    [1, 2].map((id) => ({ id, name: `${kind} ${id}`, extra: `extra ${kind} ${id}`, contact_id: id }));
  const notes = [
    { id: 1, text: "note a", kind: "prospect", target_id: 1 },
    { id: 2, text: "note b", kind: "contact", target_id: 1 },
    { id: 3, text: "note c", kind: "company", target_id: 2 },
    { id: 4, text: "note d", kind: "Prospect ", target_id: 2 },
    { id: 5, text: "note e", kind: "event", target_id: 1 },
  ];
  const lists: Record<string, unknown[]> = {
    "/api/people": people,
    "/api/matters": named("Matter"),
    "/api/contacts": named("Contact"),
    "/api/companies": named("Company"),
    "/api/notes": notes,
  };
  return {
    resolve: async () => ["93.184.216.34"],
    request: async (url: URL, o: { headers: Record<string, string> }) => {
      const key = Object.entries(o.headers).find(([k]) => k.toLowerCase() === "x-api-key")?.[1] ?? "";
      seen.keys.push(key);
      seen.urls.push(url.pathname + url.search);
      if (key !== APP_KEY) return { status: 401, text: "{}" };
      if (opts.hang && url.pathname === opts.hang.path) {
        hangSeen++;
        if (hangSeen > (opts.hang.skip ?? 0) && hung < opts.hang.times) {
          hung++;
          return new Promise<never>(() => undefined);
        }
      }
      const rows = lists[url.pathname];
      if (!rows) return { status: 404, text: "{}" };
      if (url.pathname === "/api/people" && opts.failOnce) {
        peopleRequests++;
        if (peopleRequests === opts.failOnce.at && !failed) {
          failed = true;
          if (opts.failOnce.mode === "drop") throw new Error("ECONNRESET: the app dropped the connection");
          return { status: 500, text: "{}" };
        }
      }
      const page = Number(url.searchParams.get("page") ?? "1");
      const per = Number(url.searchParams.get("per_page") ?? "10");
      return { status: 200, text: JSON.stringify({ data: rows.slice((page - 1) * per, page * per) }) };
    },
  };
}

/** `only: "people"` is the spec of the sealed walks: one object, so the first pull is one scheduled run, not five (a loaded runner took over 90 s for five). */
export const spec = (only?: "people", pageSize = 10) => {
  const all = full();
  if (only !== "people") return all;
  return {
    ...all,
    objects: all.objects
      .filter((o) => o.remote === "people")
      .map((o) => ({ ...o, list: { ...o.list, cursor: { ...o.list.cursor, size: pageSize } } })),
    mapping: all.mapping.filter((m) => m.remote === "people"),
  };
};
const full = () => ({
  app: { name: "Crm", domain: DOMAIN },
  auth: { vaultHandle: "#Crm_Key", style: "header", header: "X-Api-Key" },
  objects: [
    {
      remote: "people",
      label: "Person",
      id: "/id",
      itemsAt: "/data",
      list: { path: "/api/people", cursor: { kind: "page", param: "page", size: 10, sizeParam: "per_page" } },
      fields: [
        { path: "/attributes/name", label: "Name", type: "text" },
        { path: "/attributes/social_security", label: "Social Security", type: "sealed" },
        { path: "/attributes/custom_field_values/77/formatted_value", label: "Custom SSN", type: "sealed" },
      ],
    },
    ...[
      ["matters", "Matter"],
      ["contacts", "Contact"],
      ["companies", "Company"],
    ].map(([remote, label]) => ({
      remote,
      label,
      id: "/id",
      itemsAt: "/data",
      list: { path: `/api/${remote}`, cursor: { kind: "page", param: "page", size: 10, sizeParam: "per_page" } },
      fields: [{ path: "/name", label: "Name", type: "text" }],
    })),
    {
      remote: "notes",
      label: "Note",
      id: "/id",
      itemsAt: "/data",
      list: { path: "/api/notes", cursor: { kind: "page", param: "page", size: 10, sizeParam: "per_page" } },
      fields: [
        { path: "/text", label: "Text", type: "text" },
        { path: "/kind", label: "Kind", type: "text" },
        ...[
          ["matter_of", "prospect", "matters", "Matter"],
          ["contact_of", "contact", "contacts", "Contact"],
          ["company_of", "company", "companies", "Company"],
        ].map(([key, kind, to, label]) => ({
          path: "/target_id",
          key,
          label,
          type: "relation",
          relationTo: to,
          onlyWhen: { path: "/kind", equals: kind },
        })),
      ],
    },
  ],
  mapping: [
    {
      remote: "people",
      recordType: "person",
      titleField: "/attributes/name",
      fields: [
        { path: "/attributes/name", field: "name", direction: "pull" },
        { path: "/attributes/social_security", field: "ssn", direction: "pull" },
        { path: "/attributes/custom_field_values/77/formatted_value", field: "custom_ssn", direction: "pull" },
      ],
    },
    ...[
      ["matters", "matter"],
      ["contacts", "contact"],
      ["companies", "company"],
    ].map(([remote, recordType]) => ({
      remote,
      recordType,
      titleField: "/name",
      fields: [{ path: "/name", field: "name", direction: "pull" }],
    })),
    {
      remote: "notes",
      recordType: "note",
      titleField: "/text",
      fields: [
        { path: "/text", field: "text", direction: "pull" },
        { path: "/kind", field: "kind", direction: "pull" },
        { path: "/target_id", field: "matter_of", direction: "pull" },
        { path: "/target_id", field: "contact_of", direction: "pull" },
        { path: "/target_id", field: "company_of", direction: "pull" },
      ],
    },
  ],
  plan: { firstPull: { words: "Everything" }, backfill: "now", conflicts: "newest" },
});

/** Every byte the server wrote: each file under the data directory (databases, WAL files, logs), and what the process printed. */
export function scan(dir: string, needles: string[], printed: string): string[] {
  const hits: string[] = [];
  const walk = (p: string): void => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const f = path.join(p, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.isFile()) {
        const bytes = fs.readFileSync(f);
        for (const n of needles) if (bytes.includes(Buffer.from(n))) hits.push(`${path.relative(dir, f)}: ${n}`);
      }
    }
  };
  walk(dir);
  for (const n of needles) if (printed.includes(n)) hits.push(`stdout/stderr: ${n}`);
  return hits;
}
/** Every row of every table of a database file, read while the daemon runs (its WAL included): the secret must be in none of them. */
export function dumpDb(file: string): string {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    return tables.map((t) => JSON.stringify(db.prepare(`SELECT * FROM "${t.name}"`).all())).join("\n");
  } finally {
    db.close();
  }
}

export async function world(unlock: boolean, appOptions: AppOptions = {}, daemonOptions: Record<string, unknown> = {}) {
  const seen = { keys: [] as string[], urls: [] as string[] };
  const dir = seededDir();
  const printed: string[] = [];
  const wasOut = process.stdout.write.bind(process.stdout);
  const wasErr = process.stderr.write.bind(process.stderr);
  const spy = (w: typeof process.stdout.write): typeof process.stdout.write =>
    ((chunk: unknown, ...rest: unknown[]) => {
      printed.push(String(chunk));
      return (w as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stdout.write;
  process.stdout.write = spy(wasOut);
  process.stderr.write = spy(wasErr);
  const d = await boot(dir, (async function* () {})() as never, {
    vault: undefined,
    connectorNetwork: app(seen, appOptions),
    ...daemonOptions,
  });
  if (unlock) {
    const r = await fetch(`${d.url}/local/vault/key/unlock`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` },
      body: JSON.stringify({
        key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64"),
      }),
    });
    assert.equal(r.status, 204, `unlock: ${r.status}`);
  }
  // the app's own key, in the Space's shared Vault, as an admin keeps a key for the Space
  const folder = await call(d, "vault.folders.create", { idempotencyKey: "f1", name: "Keys", scope: "shared" });
  const item =
    folder.status === 200
      ? await call(d, "vault.item.put", {
          idempotencyKey: "i1",
          folderId: folder.data.folder.id,
          name: "Crm_Key",
          kind: "other",
          fields: [{ key: "value", value: APP_KEY, secret: true }],
        })
      : folder;
  return {
    d,
    dir,
    seen,
    folder,
    item,
    printed: () => printed.join(""),
    close: async (): Promise<void> => {
      process.stdout.write = wasOut;
      process.stderr.write = wasErr;
      await stop(d);
    },
  };
}

export const pump = async (d: Daemon): Promise<void> => {
  await d.hooks?.pump?.();
};
export const rowsOf = async (
  d: Daemon,
  type: string,
): Promise<Array<{ id: string; fields: Record<string, unknown> }>> =>
  ((await call(d, "records.query", { type })).data.rows ?? []) as Array<{
    id: string;
    fields: Record<string, unknown>;
  }>;

export async function pulled(d: Daemon, types: string[]): Promise<void> {
  await waitFor(
    async () => {
      await pump(d);
      for (const t of types) if ((await rowsOf(d, t)).length === 0) return null;
      return true;
    },
    115_000,
    () => hostLog(d),
  );
}
