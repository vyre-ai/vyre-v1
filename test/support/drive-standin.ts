// A stand-in Google Drive for a booted daemon (fixtures/suite/world.ts takes `api` for the module's JSON calls and `seam` for the token endpoint and the byte transfers).
// It keeps what the real Drive keeps that a write-back has to meet: file ids that stay when a file is renamed, moved or rewritten; a head revision id and a revision list per file; the
// parents of a file; a trash that keeps the file (and restores it); who last changed a file; whether the signed-in person may edit it (capabilities.canEdit); a change feed with a start
// token; and an idempotent create (the same create sent twice makes one file only when the caller supplied one request id; Drive's own API has no key, so the stand-in counts creates).
// What it does NOT model: Drive's real eventual consistency, quota, shortcuts, shared-drive membership rules, the 100-revision cap and its pinning, or a multi-user permission model beyond
// one canEdit flag per file.
import { createVerify } from "node:crypto";

export interface DFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed: boolean;
  bytes: Uint8Array;
  head: number;
  revs: { id: string; time: string; bytes: Uint8Array; by: { name: string; email: string } }[];
  modified: string;
  by: { name: string; email: string };
  canEdit: boolean;
  /** appProperties: what the creator stored on the file (Vyre keys its creates with one) */
  props?: Record<string, string>;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const FOLDER = "application/vnd.google-apps.folder";
const SCOPE = "https://www.googleapis.com/auth/";

export interface DriveOptions {
  user: string;
  clientEmail: string;
  publicKey: import("node:crypto").KeyObject;
}

export function driveStandIn(o: DriveOptions) {
  const files = new Map<string, DFile>();
  const changes: string[] = [];
  const requests: { method: string; path: string; query: Record<string, string>; body?: unknown }[] = [];
  const creates: string[] = [];
  let n = 0;
  let clock = Date.parse("2026-11-10T09:00:00Z");
  const me = { name: "Noah Berg", email: o.user };
  const state = {
    /** every request answers this status while set (the provider is down) */
    down: 0,
    /** a PATCH or an upload answers 403 while set (a permission was removed) */
    denyWrites: false,
    /** pages of a list answer, to test a listing larger than one pass reads */
    pageSize: 1000,
    /** revisions a page of the revision list answers (Drive: 200); a test sets it small */
    revPageSize: null as number | null,
    /** the next N creates make the file and then answer 503 (the answer is lost, the file is there) */
    createThen503: 0,
    /** the next upload to this file finds another revision saved first (a change between the check and the upload) */
    interpose: null as null | { id: string; text: string; by?: { name: string; email: string } },
    /** called with each request before it is answered: a test stops the daemon here */
    onRequest: null as null | ((r: { method: string; path: string }) => void),
    /** the matching request is applied at Drive and then never answered: the daemon is stopped at that moment (a crash in the middle of a write) */
    crashOn: null as null | { match: (r: { method: string; path: string }) => boolean; stop: () => Promise<unknown> },
  };
  const stamp = (): string => new Date((clock += 1000)).toISOString();
  /** the cells of a Google Sheet by file id and tab, as the Sheets API serves them */
  const tabs = new Map<string, Map<string, string[][]>>();
  const sheetWrites: { id: string; tab: string; range: string; values: string[][] }[] = [];
  const csvOf = (rows: string[][]): string =>
    rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n") + "\n";
  const colNum = (s: string): number => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const parseRange = (
    raw: string,
    first: string,
  ): { tab: string; c0: number; r0: number; c1?: number; r1?: number } => {
    const m = /^(?:'((?:[^']|'')+)'|([^!']+))?!?([A-Za-z]+)?(\d+)?(?::([A-Za-z]+)(\d+))?$/.exec(raw) ?? [];
    const quoted = raw.includes("!");
    const tab = quoted ? (m[1] !== undefined ? m[1].replace(/''/g, "'") : (m[2] ?? first)) : first;
    const a1 = quoted
      ? { c: m[3], r: m[4], c2: m[5], r2: m[6] }
      : (() => {
          const x = /^([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?$/.exec(raw) ?? [];
          return { c: x[1], r: x[2], c2: x[3], r2: x[4] };
        })();
    return {
      tab,
      c0: a1.c ? colNum(a1.c.toUpperCase()) : 0,
      r0: a1.r ? Number(a1.r) - 1 : 0,
      ...(a1.c2 ? { c1: colNum(a1.c2.toUpperCase()) } : {}),
      ...(a1.r2 ? { r1: Number(a1.r2) - 1 } : {}),
    };
  };
  function sheetsRoute(method: string, u: URL, headers: Record<string, string>, body: string | Uint8Array | undefined) {
    if (!claims(headers)) return { status: 401, json: { error: { code: 401 } } };
    state.onRequest?.({ method, path: u.pathname });
    const id = decodeURIComponent(/\/v4\/spreadsheets\/([^/:]+)/.exec(u.pathname)?.[1] ?? "");
    const book = tabs.get(id);
    if (!book) return { status: 404, json: { error: { code: 404 } } };
    const values = /\/values\/([^:]+)$/.exec(u.pathname);
    if (!values && method === "GET")
      return {
        json: {
          properties: { title: files.get(id)?.name ?? id },
          sheets: [...book.entries()].map(([title, rows], i) => ({
            properties: {
              sheetId: i,
              title,
              gridProperties: { rowCount: rows.length, columnCount: Math.max(1, ...rows.map((r) => r.length)) },
            },
          })),
        },
      };
    if (values) {
      const raw = decodeURIComponent(values[1]!);
      const r = parseRange(raw, [...book.keys()][0]!);
      const rows = book.get(r.tab);
      if (!rows) return { status: 400, json: { error: { code: 400 } } };
      if (method === "GET") {
        const slice = rows
          .slice(r.r0, r.r1 === undefined ? undefined : r.r1 + 1)
          .map((row) => row.slice(r.c0, r.c1 === undefined ? undefined : r.c1 + 1));
        return { json: { range: raw, values: slice } };
      }
      if (method === "PUT") {
        if (!files.get(id)?.canEdit) return { status: 403, json: { error: { code: 403 } } };
        const b = safeJson(typeof body === "string" ? body : "") as { values?: string[][] };
        let n = 0;
        (b.values ?? []).forEach((vals, i) => {
          const row = (rows[r.r0 + i] ??= []);
          vals.forEach((v, j) => {
            while (row.length < r.c0 + j) row.push("");
            row[r.c0 + j] = String(v);
            n += 1;
          });
        });
        sheetWrites.push({ id, tab: r.tab, range: raw, values: b.values ?? [] });
        const f = files.get(id)!;
        f.modified = stamp();
        changes.push(id);
        return { json: { updatedCells: n } };
      }
    }
    return undefined;
  }

  function put(f: Partial<DFile> & { id?: string; name: string }, bytes: Uint8Array | string = ""): DFile {
    n += 1;
    const data = typeof bytes === "string" ? enc.encode(bytes) : bytes;
    const id = f.id ?? `g${n}`;
    const time = stamp();
    const file: DFile = {
      id,
      name: f.name,
      mimeType: f.mimeType ?? "application/octet-stream",
      parents: f.parents ?? ["root-folder"],
      trashed: false,
      bytes: data,
      head: 1,
      revs: [{ id: `${id}-r1`, time, bytes: data, by: f.by ?? me }],
      modified: time,
      by: f.by ?? me,
      canEdit: f.canEdit ?? true,
      ...(f.props !== undefined ? { props: f.props } : {}),
    };
    files.set(id, file);
    changes.push(id);
    return file;
  }
  /** someone else saves a new revision there */
  function elsewhere(id: string, bytes: string, by = { name: "Kim Ito", email: "kim@firm.test" }): void {
    const f = files.get(id)!;
    f.head += 1;
    f.bytes = enc.encode(bytes);
    f.modified = stamp();
    f.by = by;
    f.revs.push({ id: `${id}-r${f.head}`, time: f.modified, bytes: f.bytes, by });
    changes.push(id);
  }
  const view = (f: DFile) => ({
    ...(f.props ? { appProperties: f.props } : {}),
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    parents: f.parents,
    modifiedTime: f.modified,
    size: String(f.bytes.byteLength),
    headRevisionId: `${f.id}-r${f.head}`,
    trashed: f.trashed,
    lastModifyingUser: { displayName: f.by.name, emailAddress: f.by.email },
    capabilities: { canEdit: f.canEdit },
  });
  const claims = (headers: Record<string, string>): string | undefined =>
    /^Bearer at\|([^|]+)\|/.exec(headers["authorization"] ?? "")?.[1];

  function route(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: string | Uint8Array | undefined,
  ): { status?: number; json?: unknown; text?: string } | undefined {
    const u = new URL(url);
    if (u.hostname === "sheets.googleapis.com") return sheetsRoute(method, u, headers, body);
    if (!u.pathname.includes("/drive/v3/files") && !u.pathname.includes("/drive/v3/changes")) return undefined;
    const query = Object.fromEntries(u.searchParams.entries());
    const isBytes = u.hostname === "www.googleapis.com" && u.pathname.startsWith("/upload/");
    requests.push({
      method,
      path: u.pathname,
      query,
      ...(typeof body === "string" ? { body: safeJson(body) } : {}),
    });
    state.onRequest?.({ method, path: u.pathname });
    if (!claims(headers)) return { status: 401, json: { error: { code: 401 } } };
    if (state.down) return { status: state.down, json: { error: { code: state.down } } };
    if (u.pathname === "/drive/v3/changes/startPageToken") return { json: { startPageToken: String(changes.length) } };
    if (u.pathname === "/drive/v3/changes") {
      const from = Number(query["pageToken"]);
      const ids = [...new Set(changes.slice(from))];
      return {
        json: {
          changes: ids.map((id) => {
            const f = files.get(id)!;
            return { fileId: id, removed: false, file: view(f) };
          }),
          newStartPageToken: String(changes.length),
        },
      };
    }
    if (isBytes) {
      if (state.denyWrites) return { status: 403, json: { error: { code: 403 } } };
      const raw = body instanceof Uint8Array ? body : enc.encode(String(body ?? ""));
      // read as latin1 so the bytes of a workbook or a Word file come through whole; the JSON part is decoded as UTF-8 from the same bytes
      const text = Buffer.from(raw).toString("latin1");
      const boundary = /^--(\S+)\r\n/.exec(text)?.[1] ?? "";
      const parts = text.split(`--${boundary}`).filter((p) => p.trim() !== "" && p.trim() !== "--");
      const meta = JSON.parse(
        Buffer.from(/\r\n\r\n([\s\S]*?)\r\n$/.exec(parts[0] ?? "")?.[1] ?? "{}", "latin1").toString("utf8"),
      ) as Record<string, unknown>;
      const media = Buffer.from(
        (parts[1] ?? "").replace(/^\r\nContent-Type:[^\r]*\r\n\r\n/, "").replace(/\r\n$/, ""),
        "latin1",
      );
      const m = /\/upload\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
      if (m) {
        const f = files.get(decodeURIComponent(m[1]!));
        if (!f) return { status: 404, json: {} };
        if (!f.canEdit) return { status: 403, json: {} };
        if (meta["appProperties"])
          f.props = { ...(f.props ?? {}), ...(meta["appProperties"] as Record<string, string>) };
        if (state.interpose && state.interpose.id === f.id) {
          const i = state.interpose;
          state.interpose = null;
          elsewhere(i.id, i.text, i.by);
        }
        f.head += 1;
        f.bytes = new Uint8Array(media);
        f.modified = stamp();
        f.by = me;
        f.revs.push({ id: `${f.id}-r${f.head}`, time: f.modified, bytes: f.bytes, by: me });
        changes.push(f.id);
        return { json: view(f) };
      }
      creates.push(String(meta["name"]));
      const parents = Array.isArray(meta["parents"]) ? (meta["parents"] as string[]) : ["root-folder"];
      const made = put(
        {
          name: String(meta["name"]),
          parents,
          mimeType: String(meta["mimeType"] ?? "application/pdf"),
          ...(meta["appProperties"] ? { props: meta["appProperties"] as Record<string, string> } : {}),
        },
        new Uint8Array(media),
      );
      if (state.createThen503 > 0) {
        state.createThen503 -= 1;
        return { status: 503, json: { error: { code: 503 } } };
      }
      return { json: view(made) };
    }
    // files collection
    const one = /\/drive\/v3\/files\/([^/]+)(\/(revisions)(\/([^/]+))?|\/export)?$/.exec(u.pathname);
    if (u.pathname === "/drive/v3/files" && method === "GET") {
      const parent = /'([^']+)' in parents/.exec(query["q"] ?? "")?.[1];
      const live = (query["q"] ?? "").includes("trashed = false");
      const keyed = /appProperties has \{ key='([^']+)' and value='((?:[^'\\]|\\.)*)' \}/.exec(query["q"] ?? "");
      const all = [...files.values()].filter(
        (f) =>
          (!parent || f.parents.includes(parent)) &&
          (!live || !f.trashed) &&
          (!keyed || f.props?.[keyed[1]!] === keyed[2]!.replace(/\\(.)/g, "$1")),
      );
      const at = Number(query["pageToken"] ?? 0);
      const page = all.slice(at, at + state.pageSize);
      return {
        json: {
          files: page.map(view),
          ...(at + state.pageSize < all.length ? { nextPageToken: String(at + state.pageSize) } : {}),
        },
      };
    }
    if (u.pathname === "/drive/v3/files" && method === "POST") {
      const b = safeJson(typeof body === "string" ? body : "") as Record<string, unknown>;
      if (state.denyWrites) return { status: 403, json: {} };
      creates.push(String(b["name"]));
      const made = put({
        name: String(b["name"]),
        mimeType: String(b["mimeType"] ?? FOLDER),
        parents: (b["parents"] as string[]) ?? ["root-folder"],
        ...(b["appProperties"] ? { props: b["appProperties"] as Record<string, string> } : {}),
      });
      if (state.createThen503 > 0) {
        state.createThen503 -= 1;
        return { status: 503, json: { error: { code: 503 } } };
      }
      return { json: view(made) };
    }
    if (!one) return undefined;
    const f = files.get(decodeURIComponent(one[1]!));
    if (!f) return { status: 404, json: { error: { code: 404 } } };
    if (one[3] === "revisions" && !one[5])
    {
      const size = state.revPageSize ?? Number(query["pageSize"] ?? 200);
      const at = Number(query["pageToken"] ?? 0);
      return {
        json: {
          revisions: f.revs.slice(at, at + size).map((r) => ({
            id: r.id,
            modifiedTime: r.time,
            size: String(r.bytes.byteLength),
            lastModifyingUser: { displayName: r.by.name, emailAddress: r.by.email },
          })),
          ...(at + size < f.revs.length ? { nextPageToken: String(at + size) } : {}),
        },
      };
    }
    if (one[3] === "revisions") {
      const r = f.revs.find((x) => x.id === decodeURIComponent(one[5]!));
      return r ? { bytes: r.bytes, text: dec.decode(r.bytes) } : { status: 404, json: {} };
    }
    if (one[2] === "/export" && f.mimeType === "application/vnd.google-apps.spreadsheet") {
      const first = [...(tabs.get(f.id)?.values() ?? [])][0] ?? [];
      return { text: csvOf(first), bytes: enc.encode(csvOf(first)) };
    }
    if (method === "GET" && query["alt"] === "media") return { bytes: f.bytes, text: dec.decode(f.bytes) };
    if (method === "GET") return { json: view(f) };
    if (method === "PATCH") {
      if (state.denyWrites || !f.canEdit) return { status: 403, json: { error: { code: 403 } } };
      const b = safeJson(typeof body === "string" ? body : "") as Record<string, unknown>;
      if (typeof b["name"] === "string") f.name = b["name"];
      if (typeof b["trashed"] === "boolean") f.trashed = b["trashed"];
      if (query["addParents"]) f.parents = [...new Set([...f.parents, ...query["addParents"].split(",")])];
      if (query["removeParents"]) {
        const gone = new Set(query["removeParents"].split(","));
        f.parents = f.parents.filter((p) => !gone.has(p));
      }
      f.modified = stamp();
      changes.push(f.id);
      return { json: view(f) };
    }
    return undefined;
  }

  /** runs a request, and when it is the one a test crashes on, applies it, stops the daemon and never answers */
  function crashable<T>(r: { method: string; url: string }, run: () => T): T | Promise<never> {
    const out = guarded(run);
    const c = state.crashOn;
    if (c && c.match({ method: r.method, path: new URL(r.url).pathname })) {
      state.crashOn = null;
      // the answer never reaches the daemon: its connection is reset once the daemon is down (the same process holds both lives of the daemon, so the old pass must end for the new one to run)
      return c.stop().then(() => {
        throw new Error("connection reset");
      });
    }
    return out;
  }
  const api = (r: { method: string; url: string; headers: Record<string, string>; body: string | undefined }) =>
    crashable(r, () => route(r.method, r.url, r.headers, r.body));

  const seam = (r: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string | Uint8Array | undefined;
  }) => {
    if (r.url === "https://oauth2.googleapis.com/token") {
      const form = new URLSearchParams(String(r.body));
      const [h, p, sig] = (form.get("assertion") ?? "").split(".");
      if (
        !h ||
        !p ||
        !sig ||
        !createVerify("RSA-SHA256").update(`${h}.${p}`).verify(o.publicKey, Buffer.from(sig, "base64url"))
      )
        return { status: 400, json: { error: "invalid_grant" } };
      const c = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as { sub: string; scope: string };
      return { json: { access_token: `at|${c.sub}|${c.scope.split(" ")[0]!.slice(SCOPE.length)}`, expires_in: 3600 } };
    }
    return crashable(r, () => route(r.method, r.url, r.headers, r.body));
  };

  /** A bug in the stand-in must show as itself, not as the daemon's retry of a failed fetch. */
  function guarded<T>(run: () => T): T {
    try {
      return run();
    } catch (e) {
      console.error("drive stand-in threw", e);
      throw e;
    }
  }

  return {
    files,
    changes,
    requests,
    creates,
    state,
    /** a Google Sheet: its tabs and their cells (the file itself is put() with the spreadsheet type) */
    sheet: (id: string, book: Record<string, string[][]>): void =>
      void tabs.set(id, new Map(Object.entries(book).map(([k, v]) => [k, v.map((r) => [...r])] as const))),
    sheetTabs: tabs,
    sheetWrites,
    put,
    elsewhere,
    api,
    seam,
    byName: (name: string): DFile | undefined => [...files.values()].find((f) => f.name === name && !f.trashed),
    text: (id: string): string => dec.decode(files.get(id)!.bytes),
  };
}

function safeJson(s: string): unknown {
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}
