// A stand-in for GitHub's git server: real bare repositories served by `git http-backend`, with GitHub's rule that a token must be known and that a push needs a write token. It records which
// kind of token each request carried, so a test can say that a write token never reached GitHub for a push that was held, denied or timed out.
import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface Seen { method: string; path: string; query: string; kind: "none" | "read" | "write" | "unknown"; status: number }
export interface FakeGit {
  url: string;
  root: string;
  seen: Seen[];
  tokens: Map<string, "read" | "write">;
  /** Answer the upload-pack advertisement of a read token with 503 (a push cannot learn the default branch), when set after the first clone. */
  failAdvert: { on: boolean };
  gitDir(repo: string): string;
  /** The commit a ref points at in the server's repository, or null. */
  ref(repo: string, ref: string): string | null;
  writes(): Seen[];
  close(): Promise<void>;
}

const git = (cwd: string, ...args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();

/** Make a bare repository `<owner>/<name>.git` with one commit on `branch`. */
export function seedRepo(root: string, repo: string, branch = "main"): void {
  const bare = path.join(root, `${repo}.git`);
  fs.mkdirSync(bare, { recursive: true });
  git(bare, "init", "--bare", "-b", branch);
  git(bare, "config", "http.receivepack", "true");
  git(bare, "config", "receive.denyDeleteCurrent", "ignore");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-seed-"));
  try {
    git(work, "init", "-b", branch);
    fs.writeFileSync(path.join(work, "README.md"), "# site\n");
    git(work, "add", ".");
    git(work, "commit", "-m", "first");
    git(work, "push", bare, `${branch}:${branch}`);
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

export async function fakeGithubGit(repos: string[] = ["vyre-ai/website"], branch = "main"): Promise<FakeGit> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-fakegh-"));
  for (const r of repos) seedRepo(root, r, branch);
  const seen: Seen[] = [];
  const tokens = new Map<string, "read" | "write">();
  const failAdvert = { on: false };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const m = /^Basic (.+)$/i.exec(String(req.headers.authorization ?? ""));
    const pass = m ? Buffer.from(m[1]!, "base64").toString("utf8").split(":").slice(1).join(":") : "";
    const kind: Seen["kind"] = !m ? "none" : tokens.get(pass) ?? "unknown";
    const isPush = url.pathname.endsWith("/git-receive-pack") || url.searchParams.get("service") === "git-receive-pack";
    const log = (status: number): void => { seen.push({ method: req.method ?? "GET", path: url.pathname, query: url.search, kind, status }); };
    if (kind === "none" || kind === "unknown") { log(401); res.writeHead(401, { "www-authenticate": 'Basic realm="GitHub"' }); res.end("Authentication required\n"); return; }
    if (isPush && kind !== "write") { log(403); res.writeHead(403, { "content-type": "text/plain" }); res.end("Write access to repository not granted.\n"); return; }
    if (failAdvert.on && url.searchParams.get("service") === "git-upload-pack") { log(503); res.writeHead(503); res.end("down\n"); return; }
    log(200);
    const cgi = spawn("git", ["http-backend"], {
      env: {
        PATH: process.env["PATH"] ?? "", GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: "1", PATH_INFO: url.pathname, REQUEST_METHOD: req.method ?? "GET", QUERY_STRING: url.search.slice(1),
        CONTENT_TYPE: String(req.headers["content-type"] ?? ""), REMOTE_USER: "x-access-token", REMOTE_ADDR: "127.0.0.1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
        ...(req.headers["content-length"] ? { CONTENT_LENGTH: String(req.headers["content-length"]) } : {}), ...(req.headers["content-encoding"] ? { HTTP_CONTENT_ENCODING: String(req.headers["content-encoding"]) } : {}),
        ...(req.headers["git-protocol"] ? { GIT_PROTOCOL: String(req.headers["git-protocol"]) } : {}),
      },
    });
    req.pipe(cgi.stdin);
    cgi.stdin.on("error", () => undefined);
    let head = Buffer.alloc(0), sent = false;
    cgi.stdout.on("data", (c: Buffer) => {
      if (sent) { res.write(c); return; }
      head = Buffer.concat([head, c]);
      const end = head.indexOf("\r\n\r\n");
      if (end < 0) return;
      const lines = head.subarray(0, end).toString("latin1").split("\r\n");
      let status = 200; const headers: Record<string, string> = {};
      for (const l of lines) { const i = l.indexOf(":"); if (i < 0) continue; const k = l.slice(0, i).toLowerCase(), v = l.slice(i + 1).trim(); if (k === "status") status = parseInt(v, 10); else headers[k] = v; }
      res.writeHead(status, headers);
      sent = true;
      res.write(head.subarray(end + 4));
    });
    cgi.on("close", () => { if (!sent) { res.writeHead(500); } res.end(); });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`, root, seen, tokens, failAdvert,
    gitDir: (repo) => path.join(root, `${repo}.git`),
    ref: (repo, ref) => { try { return git(path.join(root, `${repo}.git`), "rev-parse", "--verify", "-q", ref) || null; } catch { return null; } },
    writes: () => seen.filter((s) => s.kind === "write"),
    close: async () => { server.closeAllConnections?.(); await new Promise<void>((ok) => server.close(() => ok())); fs.rmSync(root, { recursive: true, force: true }); },
  };
}
