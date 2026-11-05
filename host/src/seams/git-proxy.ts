// The Vyre git proxy: a Claude Code or Codex session pushes and fetches through the Space, never straight to GitHub, and never holds a GitHub token.
//   GET  /git/github/<owner>/<repo>.git/info/refs?service=git-upload-pack|git-receive-pack
//   POST /git/github/<owner>/<repo>.git/git-upload-pack      (a fetch or clone: forwarded with a read token)
//   POST /git/github/<owner>/<repo>.git/git-receive-pack     (a push: the command list is read first, then the person's settings decide)
// The session's git is pointed here by url.<space>/git/github/.insteadOf=https://github.com/ and a credential helper that hands over the proxy token (modules/engine/github-session.ts).
//
// DECISION: the proxy token is the only thing a session holds. It is made for one session, scoped to the repositories of that chat, ends after a few hours, and is revoked when the process ends.
//   A GitHub token is made only for the length of one request, through the one broker (github.token), and never leaves this file.
// DECISION: every ref in a push is judged before anything is forwarded, and the push is all or nothing: one ref held, refused or denied means no ref lands.
// DECISION: the default branch is push_default, any other branch, a tag or a delete is push_branch, and a delete of the default branch is held for the person's OK whatever their settings say.
// DECISION: Ask me first parks the request. The git client stays connected (side-band progress lines when it can read them) until the person answers, the answer is no, or ten minutes pass.
//   A no and a timeout end in git's own "remote rejected" line and GitHub is never called with a write token.
// DECISION: the pack is streamed, never held. Only the command list (capped) is read, and every byte after it is handed on as it arrives.
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { defaultBranchOf, MAX_COMMAND_BYTES, needsOf, oneLine, PktError, readUpdate, refusedReport, remoteLine, repoOfPath } from "../../../lib/git-proxy.ts";
import type { RefNeed, Update } from "../../../lib/git-proxy.ts";
import type { CtxSeed, InvokeResult } from "../invoke.ts";

export const GIT_PATH = "/git/github/";
export const PARK_MS = 10 * 60_000;
const SESSION_MS = 6 * 3_600_000;
const MAX_SESSIONS = 500;
const MAX_PARKED = 4;
/** What a parked push may put on disk while it waits (its pack, so the connection finishes its upload and the server's normal request timeout is never in the way). */
const MAX_SPOOL = 2 * 1024 ** 3;

export type GitInvoke = (cap: string, input: unknown, seed: CtxSeed) => Promise<InvokeResult>;
export interface GitSessionIn { person: string; agentId?: string; threadId: string; repos: readonly string[] }
export interface GitSession { person: string; agentId: string; threadId: string; repos: ReadonlySet<string>; expiresAt: number }

/** What the engine is handed to point a session's git here (modules/engine/github-session.ts): a token, and the address of this proxy. */
export interface GitProxyPort {
  mint(s: GitSessionIn): { token: string; expiresAt: number };
  revoke(token: string): void;
  /** The address the session reaches this Space at, no trailing slash. */
  base(): string;
}

export interface GitProxyDeps {
  space: string;
  now?: () => number;
  invoke: GitInvoke;
  /** The token behind a filler handle, once (the host's filler). */
  fill: (handle: string) => string | null;
  /** Where GitHub's git server is. Tests point it at their own. */
  upstream?: string;
  base: () => string;
  /** The Gate's answers, read from the event log: where it ends now, and the gate events after a point. */
  gate: { head(): Promise<number>; since(seq: number): Promise<Array<{ seq: number; name: string; payload: Record<string, unknown> }>> };
  /** How long a parked push waits for the person. */
  parkMs?: number;
  keepAliveMs?: number;
  pollMs?: number;
  log?: (msg: string, attrs?: Record<string, unknown>) => void;
}

type Hold = "held" | "approved" | "denied" | "expired";
type Asked = { ok: string } | { held: string } | { refused: string };

const sha = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");
const sleep = (ms: number): Promise<void> => new Promise((r) => { const t = setTimeout(r, ms); (t as { unref?: () => void }).unref?.(); });
const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "set-cookie", "content-length", "host"]);

function messageOf(e: unknown): string {
  const m = (e as { error?: { message?: unknown } } | undefined)?.error?.message ?? (e as { message?: unknown } | undefined)?.message;
  return typeof m === "string" && m !== "" ? oneLine(m) : "GitHub could not be reached through Vyre. Try again.";
}

export function createGitProxy(d: GitProxyDeps): { port: GitProxyPort; handle(req: http.IncomingMessage, res: http.ServerResponse): boolean; live(): number } {
  const now = d.now ?? Date.now;
  const upstream = new URL(d.upstream ?? "https://github.com");
  const parkMs = d.parkMs ?? PARK_MS, keepAliveMs = d.keepAliveMs ?? 8_000, pollMs = d.pollMs ?? 1_000;
  const sessions = new Map<string, GitSession>();
  const parked = new Map<string, number>();

  const port: GitProxyPort = {
    mint(s) {
      for (const [k, v] of sessions) if (v.expiresAt <= now()) sessions.delete(k);
      if (sessions.size >= MAX_SESSIONS) { const oldest = [...sessions.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0]; if (oldest) sessions.delete(oldest[0]); }
      const token = `vgp_${crypto.randomBytes(32).toString("base64url")}`, expiresAt = now() + SESSION_MS;
      sessions.set(sha(token), { person: s.person, agentId: s.agentId ?? "", threadId: s.threadId, repos: new Set(s.repos.map((r) => r.toLowerCase())), expiresAt });
      return { token, expiresAt };
    },
    revoke(token) { sessions.delete(sha(token)); },
    base: () => d.base().replace(/\/+$/, ""),
  };

  /** The person, for the reads that are theirs to make (their name, their settings). */
  const seed = (s: GitSession): CtxSeed => ({ space: d.space, principal: { kind: "person", id: s.person }, origin: "engine" } as CtxSeed);
  /**
   * The session's agent, acting for the person. A GitHub token is asked for this way and no other: the Gate never holds a person's own act, so a call made as the person would pass "Ask me first" without asking.
   * An agent acting for a person is held, and the person decides.
   */
  const agentSeed = (s: GitSession): CtxSeed => ({ space: d.space, principal: { kind: "agent", id: s.agentId }, actingFor: s.person, origin: "engine" } as CtxSeed);
  const log = (msg: string, attrs?: Record<string, unknown>): void => { try { d.log?.(msg, attrs); } catch { /* a log that fails never stops a push */ } };

  async function first(s: GitSession): Promise<string> {
    try {
      const r = await d.invoke("identity.whoami", {}, seed(s));
      const name = r.status === "ok" ? (r.output as { name?: unknown } | null)?.name : undefined;
      return typeof name === "string" && name.trim() ? oneLine(name.trim().split(/\s+/)[0]!) : "you";
    } catch { return "you"; }
  }

  /** One use of GitHub under the person's settings: a token (Always, or an approval still good), a hold (Ask me first), or the person's own words for why not (Never). `force` asks for a fresh yes first. */
  async function ask(s: GitSession, repo: string, action: "read" | "push_branch" | "push_default", force: boolean, consumer = "git.proxy"): Promise<Asked> {
    if (!s.agentId) return { refused: "This session has no agent to ask for, so GitHub is not available to it." };
    try {
      if (force) {
        const a = await d.invoke("github.me.approve", { repo, action, consumer }, agentSeed(s));
        if (a.status === "held") return { held: a.taskId };
      }
      const r = await d.invoke("github.token", { repo, action, consumer }, agentSeed(s));
      if (r.status === "held") return { held: r.taskId };
      const handle = (r.output as { handle?: unknown } | null)?.handle;
      const token = typeof handle === "string" ? d.fill(handle) : null;
      return token ? { ok: token } : { refused: "GitHub did not hand over a token. Try again." };
    } catch (e) {
      const held = (e as { error?: { code?: string; details?: { taskId?: unknown } } })?.error;
      if (held?.code === "permission.needs_approval" && typeof held.details?.taskId === "string") return { held: held.details.taskId };
      return { refused: messageOf(e) };
    }
  }

  /** The card in the chat that names the push waiting for a yes and opens its task. */
  async function card(s: GitSession, taskId: string, title: string): Promise<void> {
    if (!s.threadId.startsWith("thr_")) return;
    try {
      const principal = s.agentId ? { kind: "agent" as const, id: s.agentId } : { kind: "person" as const, id: s.person };
      await d.invoke("chat.post", { threadId: s.threadId, body: "", blocks: [{ type: "link_card", v: 1, data: { icon: "approval", lead: "Approval", title, target: { type: "task", id: taskId } } }], idempotencyKey: `gitp-${taskId}` },
        { space: d.space, principal, ...(s.agentId ? { actingFor: s.person } : {}), thread: s.threadId, origin: "engine" } as CtxSeed);
    } catch (e) { log("git proxy: the approval card was not posted", { error: messageOf(e) }); }
  }

  type Wait = { until: "ok"; token: string } | { until: "no"; message: string };
  interface Say { title: string; phrase: string }

  /**
   * Get one token, waiting for the person when their settings say to ask. `onWait` is told once a push is parked (to start the progress lines), `onTick` now and then while it waits, and `gone()` says the
   * client left. `say` names the use: "Push to main" for the card, "the push to main" inside a sentence.
   */
  async function obtain(s: GitSession, repo: string, action: "read" | "push_branch" | "push_default", say: Say, o: { force?: boolean; consumer?: string; onWait?: (who: string) => void; onTick?: (who: string) => void; gone: () => boolean }): Promise<Wait> {
    let a = await ask(s, repo, action, o.force === true, o.consumer);
    if ("ok" in a) return { until: "ok", token: a.ok };
    if ("refused" in a) return { until: "no", message: a.refused };
    const who = await first(s);
    const key = `${s.person}|${repo}`;
    if ((parked.get(key) ?? 0) >= MAX_PARKED) return { until: "no", message: "Too many pushes are already waiting for an answer. Answer them in Vyre, then try again." };
    parked.set(key, (parked.get(key) ?? 0) + 1);
    try {
      void card(s, a.held, `${say.title} on ${repo}`);
      o.onWait?.(who);
      const deadline = now() + parkMs;
      let tick = now(), cursor = await d.gate.head();
      const Cap = say.phrase.charAt(0).toUpperCase() + say.phrase.slice(1);
      for (;;) {
        if (o.gone()) return { until: "no", message: "The push was cancelled." };
        for (const e of await d.gate.since(cursor).catch(() => [])) {
          cursor = Math.max(cursor, e.seq);
          if (e.payload["taskId"] !== a.held) continue;
          if (e.name === "gate.approved") { a = await ask(s, repo, action, false, o.consumer); return "ok" in a ? { until: "ok", token: a.ok } : { until: "no", message: "refused" in a ? a.refused : `${Cap} was approved, but GitHub still wants an answer. Try again.` }; }
          if (e.name === "gate.denied") return { until: "no", message: `${Cap} was not approved.` };
          if (e.name === "gate.expired" && e.payload["outcome"] !== "escalated") return { until: "no", message: `Nobody answered, so ${say.phrase} did not happen.` };
        }
        if (now() >= deadline) return { until: "no", message: `Nobody answered in ${Math.round(parkMs / 60_000)} minutes, so ${say.phrase} did not happen.` };
        if (now() - tick >= keepAliveMs) { tick = now(); o.onTick?.(who); }
        await sleep(Math.min(pollMs, Math.max(1, deadline - now())));
      }
    } finally {
      const n = (parked.get(key) ?? 1) - 1;
      if (n <= 0) parked.delete(key); else parked.set(key, n);
    }
  }

  // ---- talking to GitHub

  const basic = (token: string): string => `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  const agent = (): typeof http | typeof https => (upstream.protocol === "http:" ? http : https);
  const upstreamUrl = (repo: string, tail: string, query: string): URL => new URL(`${upstream.origin}/${repo}.git/${tail}${query}`);

  function passHeaders(req: http.IncomingMessage, token: string | null): http.OutgoingHttpHeaders {
    const out: http.OutgoingHttpHeaders = {};
    for (const k of ["content-type", "accept", "accept-encoding", "git-protocol", "user-agent", "content-encoding", "content-length", "pragma", "cache-control"]) { const v = req.headers[k]; if (v !== undefined) out[k] = v; }
    if (token) out["authorization"] = basic(token);
    return out;
  }

  function open(method: string, url: URL, headers: http.OutgoingHttpHeaders): { req: http.ClientRequest; response: Promise<http.IncomingMessage> } {
    const req = agent().request(url, { method, headers });
    const response = new Promise<http.IncomingMessage>((resolve, reject) => { req.once("response", resolve); req.once("error", reject); });
    return { req, response };
  }

  async function getAll(url: URL, headers: http.OutgoingHttpHeaders, max: number): Promise<{ status: number; body: Buffer }> {
    const { req, response } = open("GET", url, headers);
    req.end();
    const r = await response;
    const chunks: Buffer[] = []; let size = 0;
    for await (const c of r) { size += (c as Buffer).length; if (size > max) { r.destroy(); break; } chunks.push(c as Buffer); }
    return { status: r.statusCode ?? 502, body: Buffer.concat(chunks) };
  }

  /** The branch GitHub calls the default, read from the advertisement of upload-pack. */
  async function defaultsOf(repo: string, readToken: string): Promise<string[]> {
    try {
      const got = await getAll(upstreamUrl(repo, "info/refs", "?service=git-upload-pack"), { authorization: basic(readToken), "user-agent": "git/2.43 vyre-proxy" }, 256 * 1024);
      const b = got.status === 200 ? defaultBranchOf(got.body) : null;
      return b ? [b] : ["main", "master"];
    } catch { return ["main", "master"]; }
  }

  function relay(r: http.IncomingMessage, res: http.ServerResponse): void {
    const headers: http.OutgoingHttpHeaders = { "cache-control": "no-store" };
    for (const [k, v] of Object.entries(r.headers)) if (v !== undefined && !HOP.has(k) && k !== "cache-control") headers[k] = v;
    res.writeHead(r.statusCode ?? 502, headers);
    r.pipe(res);
    r.once("error", () => res.destroy());
  }

  const plain = (res: http.ServerResponse, status: number, text: string, extra: http.OutgoingHttpHeaders = {}): void => {
    if (res.headersSent) { res.end(); return; }
    res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...extra });
    res.end(`${text}\n`);
  };

  function sessionOf(req: http.IncomingMessage): GitSession | null {
    const h = String(req.headers.authorization ?? "");
    let token = "";
    if (/^basic /i.test(h)) { const raw = Buffer.from(h.slice(6).trim(), "base64").toString("utf8"); token = raw.slice(raw.indexOf(":") + 1); }
    else if (/^bearer /i.test(h)) token = h.slice(7).trim();
    if (!token.startsWith("vgp_")) return null;
    const s = sessions.get(sha(token));
    if (!s) return null;
    if (s.expiresAt <= now()) { sessions.delete(sha(token)); return null; }
    return s;
  }

  // ---- a fetch

  async function upload(s: GitSession, repo: string, tail: "info/refs" | "git-upload-pack", req: http.IncomingMessage, res: http.ServerResponse, query: string): Promise<void> {
    const inScope = s.repos.has(repo.toLowerCase());
    // a repository outside this chat is read without any credential: a public one works, a private one is GitHub's own refusal
    let token: string | null = null;
    if (inScope) {
      const got = await obtain(s, repo, "read", { title: "Read", phrase: "the read" }, { gone: () => res.destroyed });
      if (got.until === "no") return plain(res, 403, got.message);
      token = got.token;
    }
    const { req: up, response } = open(req.method ?? "GET", upstreamUrl(repo, tail, query), passHeaders(req, token));
    up.once("error", () => { /* surfaced through response */ });
    if (req.method === "POST") req.pipe(up); else up.end();
    let r: http.IncomingMessage;
    try { r = await response; } catch { return plain(res, 502, "GitHub could not be reached."); }
    relay(r, res);
  }

  // ---- a push

  /** Read the request until the command list is complete. Returns what was read, so none of it is lost. */
  async function readCommands(it: AsyncIterator<Buffer>, got: { bytes: number }): Promise<{ update: Update; head: Buffer }> {
    let buf = Buffer.alloc(0);
    for (;;) {
      got.bytes = buf.length;
      const u = readUpdate(buf);
      if (u) return { update: u, head: buf };
      if (buf.length > MAX_COMMAND_BYTES + 8) throw new PktError("The list of changes in this push is too long.", "too_big");
      const n = await it.next();
      if (n.done) throw new PktError("The push ended before its list of changes did.");
      buf = Buffer.concat([buf, n.value as Buffer]);
    }
  }

  const sayOf = (needs: RefNeed[]): Say => {
    const del = needs.every((n) => n.kind === "delete"), n = needs.length, one = needs[0]!.short;
    if (del) return n === 1 ? { title: `Delete ${one}`, phrase: `the delete of ${one}` } : { title: `Delete ${n} branches`, phrase: `the delete of ${n} branches` };
    if (needs[0]!.need === "push_default") return { title: `Push to ${one}`, phrase: `the push to ${one}` };
    return n === 1 ? { title: `Push ${one}`, phrase: `the push of ${one}` } : { title: `Push ${n} branches`, phrase: `the push of ${n} branches` };
  };

  async function receive(s: GitSession, repo: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!s.repos.has(repo.toLowerCase())) return plain(res, 403, `This session can push only to the repositories of its chat. ${repo} is not one of them.`);
    const enc = String(req.headers["content-encoding"] ?? "").toLowerCase();
    if (enc !== "" && enc !== "identity") return plain(res, 415, "Vyre reads a push as it arrives, so it cannot take one that is compressed.");
    if (!/^application\/x-git-receive-pack-request\b/i.test(String(req.headers["content-type"] ?? ""))) return plain(res, 415, "That is not a git push.");
    const it = req[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
    let gone = false;
    res.once("close", () => { if (!res.writableEnded) gone = true; });
    // While the push waits for the person, the rest of its body is taken off the connection onto disk, so the upload finishes at once and the server's ordinary request timeout never reaches a
    // parked push. It is replayed to GitHub after the yes and deleted either way. Nothing is read into memory beyond one chunk.
    let spool: { file: string; done: Promise<boolean> } | null = null;
    let stopSpool = false;
    const startSpool = (): void => {
      if (spool) return;
      const file = path.join(os.tmpdir(), `vyre-gitp-${crypto.randomUUID()}`);
      const ws = fs.createWriteStream(file, { mode: 0o600 });
      ws.on("error", () => { stopSpool = true; });
      spool = { file, done: (async (): Promise<boolean> => {
        let bytes = 0, ok = true;
        try {
          for (;;) {
            const n = await it.next();
            if (n.done) break;
            bytes += (n.value as Buffer).length;
            if (bytes > MAX_SPOOL) ok = false;
            if (stopSpool || !ok) continue;   // dropped: the push is over or too big, what is left is read and discarded
            if (!ws.write(n.value as Buffer)) await once(ws, "drain");
          }
        } catch { ok = false; }
        ws.end();
        await once(ws, "close").catch(() => undefined);
        return ok && !stopSpool;
      })() };
    };
    const dropSpool = (): void => { stopSpool = true; const sp = spool; if (sp) void sp.done.finally(() => fs.rm(sp.file, { force: true }, () => undefined)); };

    let read: { update: Update; head: Buffer };
    const got = { bytes: 0 };
    try { read = await readCommands(it, got); }
    catch (e) {
      // git sends a lone flush ahead of a large push, only to learn that the address answers: it is answered here, and nothing goes to GitHub
      if (e instanceof PktError && e.code === "empty") {
        const more = got.bytes === 4 ? await it.next() : { done: false };
        if (more.done) { res.writeHead(200, { "content-type": "application/x-git-receive-pack-result", "cache-control": "no-store" }); res.end(); return; }
      }
      req.resume();
      return plain(res, e instanceof PktError && e.code === "too_big" ? 413 : 400, e instanceof Error ? e.message : "That is not a git push.");
    }
    const { update, head } = read;
    const refuse = (message: string): void => {
      log("git proxy: a push was turned down", { repo, refs: update.commands.length });
      if (spool) dropSpool(); else req.resume();   // what the client is still sending is read and dropped, never kept
      if (res.headersSent) { res.write(remoteLine(message)); res.end(refusedReport(update.commands, message, update.sideBand)); return; }
      if (update.reportStatus) {
        res.writeHead(200, { "content-type": "application/x-git-receive-pack-result", "cache-control": "no-store" });
        res.end(Buffer.concat([update.sideBand ? remoteLine(message) : Buffer.alloc(0), refusedReport(update.commands, message, update.sideBand)]));
      } else plain(res, 403, message);
    };

    // the default branch, from a read of the repository, so a ref is judged by what GitHub calls the default and never by what the client says
    const readTok = await obtain(s, repo, "read", { title: "Read", phrase: "the read" }, { gone: () => gone });
    if (readTok.until === "no") return refuse(readTok.message);
    const needs = needsOf(update.commands, await defaultsOf(repo, readTok.token));

    // judged before anything is forwarded: the default branch first (it is the one most likely to wait), then the rest. One no is a no for the whole push.
    let writeToken: string | null = null;
    const begun: { v: boolean } = { v: false };
    const start = (): void => {
      if (begun.v || !update.sideBand) return;
      begun.v = true;
      res.writeHead(200, { "content-type": "application/x-git-receive-pack-result", "cache-control": "no-store" });
    };
    const kinds: Array<"push_default" | "push_branch"> = (["push_default", "push_branch"] as const).filter((k) => needs.some((n) => n.need === k));
    for (const kind of kinds) {
      const mine = needs.filter((n) => n.need === kind), say = sayOf(mine);
      const got = await obtain(s, repo, kind, say, {
        force: mine.some((n) => n.always),
        // a push to the default branch is approved for exactly that push, once: repo, ref, old and new object (modules/github/handlers/me.ts)
        ...(kind === "push_default" ? { consumer: `git.push:${crypto.createHash("sha256").update(`${repo}\n${mine.map((n) => `${n.command.ref} ${n.command.old} ${n.command.new}`).sort().join("\n")}`).digest("hex").slice(0, 16)}` } : {}),
        gone: () => gone,
        onWait: (who) => { startSpool(); start(); if (begun.v) res.write(remoteLine(`Waiting for ${who} to approve ${say.phrase}. Approve it in Vyre.`)); },
        onTick: (who) => { if (begun.v) res.write(remoteLine(`Still waiting for ${who} to approve ${say.phrase}...`)); },
      });
      if (got.until === "no") return refuse(got.message);
      writeToken ??= got.token;
    }
    if (!writeToken || gone) return refuse(gone ? "The push was cancelled." : "No token was made for this push.");

    // all ref changes are cleared: forward the command list as it came, then the rest of the body as it arrives
    const headers = passHeaders(req, writeToken);
    const { req: up, response } = open("POST", upstreamUrl(repo, "git-receive-pack", ""), headers);
    up.once("error", () => { /* surfaced through response */ });
    let r: http.IncomingMessage;
    const pump = (async (): Promise<void> => {
      const send = async (c: Buffer): Promise<void> => { if (!up.write(c)) await new Promise<void>((ok) => up.once("drain", ok)); };
      try {
        await send(head);
        const sp = spool as { file: string; done: Promise<boolean> } | null;
        if (sp) {
          // the rest of the body is on disk: replayed in order, then deleted
          if (!(await sp.done)) { up.destroy(); return; }
          for await (const c of fs.createReadStream(sp.file)) await send(c as Buffer);
          fs.rm(sp.file, { force: true }, () => undefined);
        } else {
          for (;;) {
            const n = await it.next();
            if (n.done) break;
            await send(n.value as Buffer);
          }
        }
      } catch { /* the client or GitHub went away */ }
      up.end();
    })();
    try { r = await response; } catch { await pump; return refuse("GitHub could not be reached, so nothing was pushed."); }
    if (begun.v) {
      // the head of the answer is already sent (progress lines went first): GitHub's report follows them as it is
      if (r.statusCode !== 200) { r.resume(); await pump; return refuse(`GitHub turned the push down (HTTP ${r.statusCode ?? 0}).`); }
      r.pipe(res);
      r.once("error", () => res.destroy());
    } else relay(r, res);
    await pump;
  }

  function handle(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith(GIT_PATH)) return false;
    void (async () => {
      const found = repoOfPath(decodeURIComponent(url.pathname.slice(GIT_PATH.length)));
      if (!found) return plain(res, 404, "Not a repository address.");
      const s = sessionOf(req);
      if (!s) return plain(res, 401, "Vyre does not know this session. Start the work again from a Vyre chat.", { "www-authenticate": 'Basic realm="Vyre"' });
      const { repo, tail } = found;
      if (tail === "info/refs") {
        const service = url.searchParams.get("service");
        if (req.method !== "GET" || (service !== "git-upload-pack" && service !== "git-receive-pack")) return plain(res, 400, "Use the git smart protocol.");
        if (service === "git-upload-pack") return await upload(s, repo, "info/refs", req, res, `?service=${service}`);
        return await advertisePush(s, repo, req, res);
      }
      if (req.method !== "POST") return plain(res, 405, "Use POST.");
      if (tail === "git-upload-pack") return await upload(s, repo, "git-upload-pack", req, res, "");
      return await receive(s, repo, req, res);
    })().catch((e) => {
      log("git proxy: a request failed", { error: messageOf(e) });
      plain(res, 500, "Vyre could not pass that on.");
    });
    return true;
  }

  /**
   * The advertisement a push starts with. GitHub shows it only with write access, so it takes a write token: the first of the person's settings that lets a push through. Which refs the push
   * changes is not known yet; the command list that follows is judged one ref at a time.
   */
  async function advertisePush(s: GitSession, repo: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!s.repos.has(repo.toLowerCase())) return plain(res, 403, `This session can push only to the repositories of its chat. ${repo} is not one of them.`);
    const gone = (): boolean => res.destroyed;
    let modes: Record<string, string> = {};
    try { const r = await d.invoke("github.me.policy.get", {}, seed(s)); modes = ((r.status === "ok" ? (r.output as { policy?: Record<string, string> } | null)?.policy : undefined) ?? {}); } catch { /* the token call below says why */ }
    const open1 = (["push_branch", "push_default"] as const).filter((k) => modes[k] !== "never");
    // a push that settings let through without asking goes first; otherwise the first that is not Never, and its question is the person's once, up front
    const pick = open1.find((k) => modes[k] === "always") ?? open1[0] ?? "push_branch";
    const got = await obtain(s, repo, pick, pick === "push_default" ? { title: "Push to the default branch", phrase: "the push to the default branch" } : { title: "Push a branch", phrase: "the push of a branch" }, { gone });
    if (got.until === "no") return plain(res, 403, got.message);
    const { req: up, response } = open("GET", upstreamUrl(repo, "info/refs", "?service=git-receive-pack"), passHeaders(req, got.token));
    up.end();
    let r: http.IncomingMessage;
    try { r = await response; } catch { return plain(res, 502, "GitHub could not be reached."); }
    relay(r, res);
  }

  return { port, handle, live: () => sessions.size };
}
