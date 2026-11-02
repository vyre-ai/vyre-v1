// The app itself, from the Space (the web export of apps/app, `node scripts/app-export.mjs`): what a browser gets at the Space's address, its join links (/join/<code>) included, on an own domain behind
// Caddy and on a phone address through the relay alike. Same origin as the API, as the app expects. Only GET and HEAD, only after every route of its own has passed, and only a file of the export or,
// for a page the browser navigates to, the export's page for that path (index.html when there is none). An API path never gets a page: it falls through to the gateway and its own answer.
import fs from "node:fs";
import type http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".jpg": "image/jpeg", ".webp": "image/webp", ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8", ".map": "application/json",
};
/** Paths that belong to the gateway and the routes before it: never answered with a page, whatever the browser accepts. */
const NOT_PAGES = /^\/(v1|sync|live|local|compute|auth|oauth|mcp|p|a|u|f|book|share|portal|hooks|spaces|webhooks?|blobs?|export|fill|healthz)(\/|$)|^\/\.well-known\//;

/** The export this checkout or image carries: VYRE_APP_DIR, else apps/app/dist beside the host. Null when there is none (a dev tree that never exported). */
export function defaultAppDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const dir = env["VYRE_APP_DIR"] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../apps/app/dist");
  return fs.existsSync(path.join(dir, "index.html")) ? dir : null;
}

/** The file of the export a path names, or null: a path that leaves the folder, holds a NUL, or names nothing. */
export function appFileFor(dir: string, pathname: string, page: boolean): string | null {
  let p: string;
  try { p = decodeURIComponent(pathname); } catch { return null; }
  if (p.includes("\0") || p.includes("\\")) return null;
  const base = path.resolve(dir);
  const inside = (f: string): boolean => f === base || f.startsWith(`${base}${path.sep}`);
  const isFile = (f: string): boolean => { try { return fs.statSync(f).isFile(); } catch { return false; } };
  const exact = path.resolve(base, `.${p}`);
  if (!inside(exact)) return null;
  if (isFile(exact)) return exact;
  if (!page) return null;
  for (const c of [`${exact.replace(/\/+$/, "")}.html`, path.join(exact, "index.html")]) if (inside(c) && isFile(c)) return c;
  return path.join(base, "index.html");
}

export function createAppFilesRoute(o: { dir: () => string | null }): { handle(req: http.IncomingMessage, res: http.ServerResponse): boolean } {
  return {
    handle(req, res) {
      const method = (req.method ?? "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") return false;
      const dir = o.dir();
      if (!dir) return false;
      let url: URL;
      try { url = new URL(req.url ?? "/", "http://app"); } catch { return false; }
      if (NOT_PAGES.test(url.pathname)) return false;
      const page = /\btext\/html\b/.test(String(req.headers.accept ?? ""));
      const file = appFileFor(dir, url.pathname, page);
      if (!file) return false;
      const ext = path.extname(file).toLowerCase();
      const hashed = url.pathname.startsWith("/_expo/static/");
      res.writeHead(200, {
        "content-type": TYPES[ext] ?? "application/octet-stream",
        "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        ...(ext === ".html" ? { "content-security-policy": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" } : {}),
      });
      if (method === "HEAD") { res.end(); return true; }
      fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
      return true;
    },
  };
}
