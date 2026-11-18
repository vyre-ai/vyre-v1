// The app itself, from the Space (the web export of apps/app, `node scripts/app-export.mjs`): what a browser gets at the Space's address, its join links (/join/<code>) included, on an own domain behind
// Caddy and on a phone address through the relay alike. Same origin as the API, as the app expects. Only GET and HEAD, only after every route of its own has passed, and only a file of the export or,
// for a page the browser navigates to, the export's page for that path (index.html when there is none). An API path never gets a page: it falls through to the gateway and its own answer.
import fs from "node:fs";
import type http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { injectHints } from "./app-hints.ts";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};
/** Files worth compressing (text); images and fonts already are. */
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".webmanifest", ".svg", ".txt", ".map"]);
/** Below this a file costs more in headers than it saves. */
const MIN_COMPRESS = 1024;

/** The best encoding the browser accepts of the two this route makes: brotli, then gzip, or null. */
export function acceptedEncoding(header: unknown): "br" | "gzip" | null {
  const q = new Map<string, number>();
  for (const part of String(header ?? "")
    .toLowerCase()
    .split(",")) {
    const [name, ...params] = part.trim().split(";");
    if (!name) continue;
    const given = params.map((x) => /^\s*q\s*=\s*([0-9.]+)\s*$/.exec(x)).find((m) => m !== null && m !== undefined);
    q.set(name.trim(), given ? Number(given[1]) : 1);
  }
  const ok = (name: string): boolean => (q.get(name) ?? q.get("*") ?? 0) > 0;
  if (ok("br")) return "br";
  if (ok("gzip")) return "gzip";
  return null;
}

/** On-the-fly answers kept in memory (the export carries .br and .gz beside every text file, written by scripts/app-export.mjs; this covers an export that was not). */
const made = new Map<string, Promise<Buffer>>();
const MADE_LIMIT = 64;
function compressed(key0: string, raw: () => Promise<Buffer>, enc: "br" | "gzip"): Promise<Buffer> {
  const key = `${enc}:${key0}`;
  let p = made.get(key);
  if (!p) {
    p = raw().then(
      (buf) =>
        new Promise<Buffer>((resolve, reject) => {
          const done = (e: Error | null, out: Buffer): void => (e ? reject(e) : resolve(out));
          if (enc === "br")
            zlib.brotliCompress(
              buf,
              {
                params: {
                  [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
                  [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
                },
              },
              done,
            );
          else zlib.gzip(buf, { level: 6 }, done);
        }),
    );
    p.catch(() => made.delete(key));
    if (made.size >= MADE_LIMIT) made.delete(made.keys().next().value as string);
    made.set(key, p);
  }
  return p;
}
const readFile = (file: string): Promise<Buffer> =>
  new Promise((resolve, reject) => fs.readFile(file, (e, b) => (e ? reject(e) : resolve(b))));

/** A page with its hints, kept until the page or the scripts it names change. */
const pages = new Map<string, { sig: string; body: Buffer }>();
function pageBody(dir: string, file: string, st: fs.Stats): Buffer {
  const html = fs.readFileSync(file, "utf8");
  // the scripts the page names decide its hints: their sizes and times are in the key
  const sig = [...html.matchAll(/src="(\/_expo\/static\/js\/web\/[^"]+\.js)"/g)]
    .map((m) => {
      try {
        const x = fs.statSync(path.join(dir, m[1]!));
        return `${m[1]}:${x.size}:${x.mtimeMs}`;
      } catch {
        return m[1]!;
      }
    })
    .join("|");
  const key = `${file}:${st.size}:${st.mtimeMs}`;
  const hit = pages.get(key);
  if (hit && hit.sig === sig) return hit.body;
  const body = Buffer.from(injectHints(html, dir));
  if (pages.size > 200) pages.clear();
  pages.set(key, { sig, body });
  return body;
}

/** Paths that belong to the gateway and the routes before it: never answered with a page, whatever the browser accepts. */
const NOT_PAGES =
  /^\/(v1|sync|live|local|compute|auth|oauth|mcp|p|a|u|f|book|share|portal|hooks|spaces|webhooks?|blobs?|export|fill|healthz)(\/|$)|^\/\.well-known\//;

/** The export this checkout or image carries: VYRE_APP_DIR, else apps/app/dist beside the host. Null when there is none (a dev tree that never exported). */
export function defaultAppDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const dir =
    env["VYRE_APP_DIR"] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../apps/app/dist");
  return fs.existsSync(path.join(dir, "index.html")) ? dir : null;
}

/** The file of the export a path names, or null: a path that leaves the folder, holds a NUL, or names nothing. */
export function appFileFor(dir: string, pathname: string, page: boolean): string | null {
  let p: string;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (p.includes("\0") || p.includes("\\")) return null;
  const base = path.resolve(dir);
  const inside = (f: string): boolean => f === base || f.startsWith(`${base}${path.sep}`);
  const isFile = (f: string): boolean => {
    try {
      return fs.statSync(f).isFile();
    } catch {
      return false;
    }
  };
  const exact = path.resolve(base, `.${p}`);
  if (!inside(exact)) return null;
  if (isFile(exact)) return exact;
  if (!page) return null;
  for (const c of [`${exact.replace(/\/+$/, "")}.html`, path.join(exact, "index.html")])
    if (inside(c) && isFile(c)) return c;
  return path.join(base, "index.html");
}

export function createAppFilesRoute(o: { dir: () => string | null }): {
  handle(req: http.IncomingMessage, res: http.ServerResponse): boolean;
} {
  return {
    handle(req, res) {
      const method = (req.method ?? "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") return false;
      const dir = o.dir();
      if (!dir) return false;
      let url: URL;
      try {
        url = new URL(req.url ?? "/", "http://app");
      } catch {
        return false;
      }
      if (NOT_PAGES.test(url.pathname)) return false;
      const page = /\btext\/html\b/.test(String(req.headers.accept ?? ""));
      const file = appFileFor(dir, url.pathname, page);
      if (!file) return false;
      const ext = path.extname(file).toLowerCase();
      const hashed = url.pathname.startsWith("/_expo/static/");
      let st: fs.Stats;
      try {
        st = fs.statSync(file);
      } catch {
        return false;
      }
      // a page says what it will load next (app-hints.ts): the body is the page with that, kept in memory
      let virtual: Buffer | null = null;
      if (ext === ".html") {
        try {
          const b = pageBody(dir, file, st);
          if (b.length !== st.size) virtual = b;
        } catch {
          virtual = null;
        }
      }
      const size = virtual ? virtual.length : st.size;
      const etag = virtual
        ? `W/"${createHash("sha1").update(virtual).digest("hex").slice(0, 16)}"`
        : `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
      const head: Record<string, string> = {
        "content-type": TYPES[ext] ?? "application/octet-stream",
        // a file under /_expo/static carries its content hash in its name: a second visit asks for nothing. The page and the files that keep their names are asked about each time (a 304 when unchanged).
        "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
        etag,
        "last-modified": st.mtime.toUTCString(),
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        ...(ext === ".html"
          ? { "content-security-policy": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" }
          : {}),
      };
      if (COMPRESSIBLE.has(ext)) head["vary"] = "Accept-Encoding";
      if (req.headers["if-none-match"] === etag) {
        res.writeHead(304, head);
        res.end();
        return true;
      }
      const enc =
        COMPRESSIBLE.has(ext) && size >= MIN_COMPRESS ? acceptedEncoding(req.headers["accept-encoding"]) : null;
      if (enc && virtual) {
        head["content-encoding"] = enc;
        const body = virtual;
        void compressed(etag, () => Promise.resolve(body), enc).then(
          (buf) => {
            head["content-length"] = String(buf.length);
            res.writeHead(200, head);
            res.end(method === "HEAD" ? undefined : buf);
          },
          () => res.destroy(),
        );
        return true;
      }
      if (enc) {
        // the export's own copy when it has one and it is not older than the file (give or take a minute); otherwise made once and kept
        const sibling = `${file}.${enc === "br" ? "br" : "gz"}`;
        let pre: fs.Stats | null = null;
        try {
          const ss = fs.statSync(sibling);
          if (ss.isFile() && ss.mtimeMs + 60_000 >= st.mtimeMs) pre = ss; // written by the same export (a minute's slack for a copy that did not keep times)
        } catch {
          /* none */
        }
        head["content-encoding"] = enc;
        if (pre) {
          head["content-length"] = String(pre.size);
          res.writeHead(200, head);
          if (method === "HEAD") {
            res.end();
            return true;
          }
          fs.createReadStream(sibling)
            .on("error", () => res.destroy())
            .pipe(res);
          return true;
        }
        void compressed(`${file}:${st.size}:${st.mtimeMs}`, () => readFile(file), enc).then(
          (buf) => {
            head["content-length"] = String(buf.length);
            res.writeHead(200, head);
            res.end(method === "HEAD" ? undefined : buf);
          },
          () => res.destroy(),
        );
        return true;
      }
      head["content-length"] = String(size);
      res.writeHead(200, head);
      if (method === "HEAD") {
        res.end();
        return true;
      }
      if (virtual) {
        res.end(virtual);
        return true;
      }
      fs.createReadStream(file)
        .on("error", () => res.destroy())
        .pipe(res);
      return true;
    },
  };
}
