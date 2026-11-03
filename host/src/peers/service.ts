// One Personal Space on several computers (lane l-multidevice, owner ruling 3 Nov): every computer the person uses holds a full copy of the same Space and syncs with the others through the
// relay. This file is the part that lets a second computer in.
//
// The computer that has the Space (any of them, while it is awake):
//   - keeps its relay link up and watches its owner's name locator (crypto.ts), so a new computer can find it with the username alone;
//   - answers an ask with a pairing ticket that says which computer it is and the box key to pin;
//   - takes the new computer's request over the end-to-end channel (POST /v1/peers/enrol), shows it in Settings, Computers with a six-digit code, and waits for the person to allow it;
//   - once allowed, hands the new computer, inside the same channel, a token of its own, the Space's keys and the owner's key bundle (POST /v1/peers/enrol/status), then a copy of
//     each database and every blob (GET /v1/peers/snapshot), asked for with that token.
// The new computer (a fresh Personal Space nobody has claimed yet, driven by its own app over loopback, /local/peers/*):
//   - asks by name, reads the offers, sends the request, polls, and hands the key bundle to its app, which opens it with the person's password: only the person's own Space can have made
//     a bundle that password opens, so a stranger who answered the ask is caught there and nothing is copied;
//   - on commit, copies the Space into peer-join/ and stops; the shell starts it again, and applyPeerJoin (join.ts) moves the copy into place before any database opens.
// What crosses the relay is the ask (a name hash and a random secret), the sealed offer, and Noise frames. The relay never sees a key, a password, a token or a row.
import fs from "node:fs";
import path from "node:path";
import type http from "node:http";
import type { HostDb } from "../daemon/sqlite.ts";
import { openDb } from "../daemon/sqlite.ts";
import type { RelayBox } from "../seams/relay.ts";
import { loadRelayKeys, routeIdOf } from "../seams/relay.ts";
import { ASK_RE, SLOTS, confirmCode, nameLocator, newAskSecret, newToken, openOffer, sealOffer, slotOf, ticketLocator, tokenHash } from "./crypto.ts";
import type { Offer } from "./crypto.ts";
import { openPeerChannel } from "./link.ts";
import type { PeerChannel, PeerTarget } from "./link.ts";
import { JOIN_DIR, SECRET_FILES, STAGED_DBS } from "./join.ts";
import { packagedOrigin } from "../daemon/desktop-cors.ts";
import { createPeerSync } from "./sync.ts";
import type { CreateCells, PeerSync } from "./sync.ts";

const ASK_TTL_MS = 10 * 60_000;
const REQUEST_TTL_MS = 10 * 60_000;
const MAX_PENDING = 3;
const TICKET_TTL_MS = 2 * 60_000;
const TICK_MS = 30_000;
const SNAP_FILES = new Set(STAGED_DBS);

const b64u = (b: Uint8Array): string => Buffer.from(b).toString("base64url");
const fromB64u = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "base64url"));
const rid = (p: string): string => `${p}${b64u(globalThis.crypto.getRandomValues(new Uint8Array(12)))}`;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const httpBase = (relay: string): string => relay.replace(/^ws/, "http").replace(/\/+$/, "");

/** What a computer of the Space hands a new one once the person allowed it. Travels only inside the Noise channel. */
export interface JoinPackage {
  v: 1;
  space: string;
  spaceName: string;
  /** the new computer's own row, and its token (never stored here, only its hash) */
  peerId: string;
  token: string;
  /** every computer of the Space, so the new one can reach them */
  peers: { peerId: string; name: string; route: string; relay: string; kind: string }[];
  /** the shared box key: every computer of the Space answers a phone or a peer under it */
  box: { priv: string; pub: string };
  /** the Space's key files (hex or base64 text, as each file holds it) */
  secrets: Record<string, string>;
  /** the owner's key bundle, as the identity module keeps it: the new computer's app opens it with the person's password before anything is copied */
  bundle: unknown;
  username: string;
}

export interface PeerServiceDeps {
  root: string;
  db: () => HostDb | null;
  space: () => string | null;
  /** a Personal Space started with --peers */
  enabled: boolean;
  name: string;
  platform: string;
  relayUrl: string;
  /** the relay link, brought up when it is not */
  ensureBox: () => RelayBox | null;
  now: () => number;
  log: (msg: string, attrs?: Record<string, unknown>) => void;
  /** stop this daemon; the shell starts it again (the Mac and Windows app restart a daemon that ends on its own) */
  restart: () => void;
  WebSocket?: typeof WebSocket;
  fetch?: typeof fetch;
  /** the cell engine (sync/src/peers/cells.ts), handed over by the sync module once it is loaded */
  createCells?: () => CreateCells | null;
  /** rows came from another computer: the open apps re-read */
  changed?: () => void;
  /** how often the computers sync while awake (tests make it short) */
  roundMs?: number;
}

export interface PeerService {
  /** the relay heard someone ask for a name this computer watches */
  onAsk(loc: string, s: string): void;
  /** HTTP: /v1/peers/* (from another computer, through the relay) and /local/peers/* (this computer's own app, loopback only) */
  handle(req: http.IncomingMessage, res: http.ServerResponse): boolean;
  /** watch the owner's name, keep this computer's row, renew; runs on a timer and once at start */
  tick(): Promise<void>;
  /** keeping the copies in step with the other computers (sync.ts) */
  readonly sync: PeerSync;
  stop(): void;
}

const json = (res: http.ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};
const refuse = (res: http.ServerResponse, status: number, code: string, message: string): void => json(res, status, { error: { code, message } });

function readBody(req: http.IncomingMessage, max = 64 * 1024): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const parts: Buffer[] = [];
    let n = 0, over = false;
    req.on("data", (c: Buffer) => { n += c.length; if (n > max) { over = true; req.destroy(); return; } parts.push(c); });
    req.on("end", () => {
      if (over) { resolve(null); return; }
      try { const v = JSON.parse(Buffer.concat(parts).toString("utf8") || "{}") as unknown; resolve(v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null); } catch { resolve(null); }
    });
    req.on("error", () => resolve(null));
  });
}

const loopbackAddr = (a: string | undefined): boolean => a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
/** This computer's own app: a loopback connection that did not come in through the relay (the relay's streams also arrive on loopback, marked x-vyre-via), sent as JSON (so a browser must
 *  ask first, and desktop-cors.ts answers only the packaged app), and from the packaged app's origin or from no browser at all. A web page open on this computer cannot start a join. */
const fromOwnApp = (req: http.IncomingMessage): boolean => {
  const origin = req.headers.origin;
  return loopbackAddr(req.socket.remoteAddress) && req.headers["x-vyre-via"] !== "relay" && /^application\/json\b/.test(String(req.headers["content-type"] ?? "")) && (origin === undefined || packagedOrigin(origin));
};

function walk(dir: string, rel = ""): string[] {
  let names: fs.Dirent[];
  try { names = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return []; }
  const out: string[] = [];
  for (const n of names.sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? `${rel}/${n.name}` : n.name;
    if (n.isDirectory()) out.push(...walk(dir, r)); else if (n.isFile()) out.push(r);
  }
  return out;
}
const safeRel = (p: string): string | null => { const n = path.posix.normalize(p); return !n || n.startsWith("/") || n.startsWith("..") || n.includes("\0") || n.includes("\\") ? null : n; };

export function createPeerService(d: PeerServiceDeps): PeerService {
  const asks = new Map<string, number>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let selfRoute: string | null = null;

  const db = (): HostDb | null => { try { return d.db(); } catch { return null; } };
  const personal = (): boolean => d.enabled && Boolean(db());
  const owners = (h: HostDb): { person: string; username: string; keys: string | null }[] => {
    try { return (h.all("SELECT person_id, username, keys_json FROM identity_accounts ORDER BY created_at") as Record<string, unknown>[]).map((r) => ({ person: str(r["person_id"]), username: str(r["username"]), keys: typeof r["keys_json"] === "string" ? r["keys_json"] : null })); } catch { return []; }
  };
  const claimed = (h: HostDb): boolean => owners(h).length > 0;
  const selfId = (h: HostDb): string | null => { try { return str((h.all("SELECT peer_id FROM network_peer_self WHERE id = 1")[0] as Record<string, unknown> | undefined)?.["peer_id"]) || null; } catch { return null; } };
  const tokenFile = path.join(d.root, "peer.token");
  const ownToken = (): string | null => { try { return fs.readFileSync(tokenFile, "utf8").trim() || null; } catch { return null; } };
  const peerSync = createPeerSync({
    root: d.root, db, createCells: () => d.createCells?.() ?? null, selfId: () => { const h = db(); return h ? selfId(h) : null; }, token: ownToken,
    now: d.now, log: d.log, changed: () => d.changed?.(), ...(d.WebSocket ? { WebSocket: d.WebSocket } : {}), ...(d.roundMs ? { roundMs: d.roundMs } : {}),
  });

  /** This computer's row in network_peer, made the first time the Space has an owner and a relay route. Its token is kept in peer.token (0600) and only its hash in the row. */
  async function ensureSelf(h: HostDb, route: string): Promise<void> {
    const have = selfId(h);
    const t = d.now();
    if (have) {
      h.run("UPDATE network_peer SET route = ?, relay = ?, last_seen_at = ? WHERE id = ?", route, d.relayUrl, t, have);
      return;
    }
    const id = rid("peer_");
    const token = newToken("vpt_");
    fs.writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
    h.run("INSERT INTO network_peer (id, name, platform, kind, route, relay, token_hash, added_at, last_seen_at) VALUES (?, ?, ?, 'computer', ?, ?, ?, ?, ?)", id, d.name, d.platform, route, d.relayUrl, await tokenHash(token), t, t);
    h.run("INSERT OR REPLACE INTO network_peer_self (id, peer_id) VALUES (1, ?)", id);
  }

  async function tick(): Promise<void> {
    const h = db();
    if (!d.enabled || !h || !claimed(h)) return;
    const box = d.ensureBox();
    if (!box) return;
    let ready: { route: string; boxKey: string };
    try { ready = await box.ready; } catch { return; }
    selfRoute = ready.route;
    try { await ensureSelf(h, ready.route); } catch (e) { d.log("peers.self_failed", { why: (e as Error).message }); }
    box.watch(await Promise.all(owners(h).map((o) => nameLocator(o.username))));
    if (peerSync.ensure()) peerSync.start();
    const cut = d.now() - ASK_TTL_MS;
    for (const [s, at] of asks) if (at < cut) asks.delete(s);
    try { h.run("UPDATE network_peer_request SET state = 'expired' WHERE state IN ('pending', 'allowed') AND expires_at <= ?", d.now()); } catch { /* not migrated yet */ }
  }

  function onAsk(_loc: string, s: string): void {
    if (!ASK_RE.test(s) || asks.size > 64) return;
    asks.set(s, d.now());
    void (async () => {
      const h = db();
      const box = d.ensureBox();
      if (!h || !box) return;
      const ready = await box.ready;
      const space = d.space();
      if (!space) return;
      const offer: Offer = { v: 1, space, name: d.name, route: ready.route, box: ready.boxKey, relay: d.relayUrl };
      const slot = await slotOf(ready.route, s);
      const sealed = await sealOffer(s, slot, offer);
      const st = await box.ticket({ ...sealed, exp: d.now() + TICKET_TTL_MS });
      d.log("peers.asked", { slot, registered: String(st) });
    })().catch((e: unknown) => d.log("peers.ask_failed", { why: (e as Error).message }));
  }

  // ---- the computer that has the Space

  async function enrol(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const h = db();
    if (!h || !d.enabled || !claimed(h)) { refuse(res, 404, "validation.not_found", "This Space does not take other computers."); return; }
    const b = await readBody(req);
    const s = str(b?.["s"]), nonce = str(b?.["nonce"]), route = str(b?.["route"]);
    const name = str(b?.["name"]).trim().slice(0, 60) || "A computer", platform = str(b?.["platform"]).slice(0, 20);
    if (!ASK_RE.test(s) || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) || !/^[a-z2-7]{26}$/.test(route)) { refuse(res, 400, "validation.bad_input", "That request is not complete."); return; }
    const at = asks.get(s);
    if (at === undefined || d.now() - at > ASK_TTL_MS) { refuse(res, 403, "auth.invalid_code", "Ask for this Space by name first."); return; }
    const open = Number((h.all("SELECT count(*) AS n FROM network_peer_request WHERE state = 'pending' AND expires_at > ?", d.now())[0] as { n: number }).n);
    if (open >= MAX_PENDING) { refuse(res, 429, "rate_limit.exceeded", "Too many computers are waiting. Allow or decline them first."); return; }
    const id = rid("preq_");
    const poll = newToken("vpp_");
    const code = await confirmCode(s, nonce);
    h.run("INSERT INTO network_peer_request (id, name, platform, code, poll_hash, ask_hash, state, created_at, expires_at, peer_id) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)",
      id, name, platform, code, await tokenHash(poll), await tokenHash(s), d.now(), d.now() + REQUEST_TTL_MS, `route:${route}`);
    asks.delete(s);
    d.log("peers.requested", { request: id });
    json(res, 200, { data: { requestId: id, poll, code, name: d.name } });
  }

  function packageFor(h: HostDb, newPeer: { id: string; token: string }): JoinPackage {
    const space = d.space() ?? "";
    const keys = loadRelayKeys(d.root);
    const secrets: Record<string, string> = {};
    for (const f of SECRET_FILES) { try { secrets[f] = fs.readFileSync(path.join(d.root, f), "utf8"); } catch { /* this Space has none */ } }
    const owner = owners(h)[0];
    const peers = (h.all("SELECT id, name, route, relay, kind FROM network_peer WHERE removed_at IS NULL") as Record<string, unknown>[]).map((r) => ({ peerId: str(r["id"]), name: str(r["name"]), route: str(r["route"]), relay: str(r["relay"]), kind: str(r["kind"]) }));
    let spaceName = "Personal";
    try { spaceName = str((h.all("SELECT name FROM identity_space WHERE id = ?", space)[0] as Record<string, unknown> | undefined)?.["name"]) || spaceName; } catch { /* no identity table */ }
    return {
      v: 1, space, spaceName, peerId: newPeer.id, token: newPeer.token, peers,
      box: { priv: keys.boxPriv, pub: b64u(keys.boxPub) }, secrets,
      bundle: owner?.keys ? JSON.parse(owner.keys) as unknown : null, username: owner?.username ?? "",
    };
  }

  async function enrolStatus(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const h = db();
    if (!h || !d.enabled) { refuse(res, 404, "validation.not_found", "This Space does not take other computers."); return; }
    const b = await readBody(req);
    const id = str(b?.["requestId"]), poll = str(b?.["poll"]);
    const row = h.all("SELECT * FROM network_peer_request WHERE id = ?", id)[0] as Record<string, unknown> | undefined;
    if (!row || str(row["poll_hash"]) !== (await tokenHash(poll))) { refuse(res, 403, "auth.invalid_code", "That request is not known here."); return; }
    const state = str(row["state"]);
    if (state === "pending" && Number(row["expires_at"]) <= d.now()) { json(res, 200, { data: { state: "expired" } }); return; }
    if (state !== "allowed") { json(res, 200, { data: { state: state === "collected" ? "expired" : state } }); return; }
    // allowed: mint the new computer's token, add its row, hand everything over once
    const route = str(row["peer_id"]).replace(/^route:/, "");
    const peerId = rid("peer_");
    const token = newToken("vpt_");
    const t = d.now();
    const th = await tokenHash(token);
    h.tx(() => {
      h.run("INSERT INTO network_peer (id, name, platform, kind, route, relay, token_hash, added_at, added_by, last_seen_at) VALUES (?, ?, ?, 'computer', ?, ?, ?, ?, ?, ?)",
        peerId, str(row["name"]), str(row["platform"]), route, d.relayUrl, th, t, str(row["decided_by"]) || null, t);
      h.run("UPDATE network_peer_request SET state = 'collected', peer_id = ? WHERE id = ?", peerId, id);
    });
    // capture changes from now on, before the new computer copies anything: what is written after its copy reaches it in the first sync
    if (peerSync.ensure()) peerSync.start();
    d.log("peers.allowed", { request: id, peer: peerId });
    json(res, 200, { data: { state: "allowed", package: packageFor(h, { id: peerId, token }) } });
  }

  async function peerOf(req: http.IncomingMessage): Promise<string | null> {
    const h = db();
    const m = /^Peer (vpt_[A-Za-z0-9_-]{43})$/.exec(String(req.headers.authorization ?? ""));
    if (!h || !m) return null;
    const row = h.all("SELECT id FROM network_peer WHERE token_hash = ? AND removed_at IS NULL", await tokenHash(m[1]!))[0] as Record<string, unknown> | undefined;
    return row ? str(row["id"]) : null;
  }

  async function snapshot(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    const who = await peerOf(req);
    if (!who) { refuse(res, 401, "auth.unauthenticated", "This computer is not part of the Space."); return; }
    const file = url.searchParams.get("file") ?? "";
    if (file === "blobs" || file === "trees") { json(res, 200, { data: { files: walk(path.join(d.root, file)) } }); return; }
    const blob = file.startsWith("blobs/") ? safeRel(file.slice(6)) : null;
    const tree = file.startsWith("trees/") ? safeRel(file.slice(6)) : null;
    let src: string, tmp: string | null = null;
    if (blob) src = path.join(d.root, "blobs", blob);
    else if (tree) src = path.join(d.root, "trees", tree);
    else if (SNAP_FILES.has(file)) {
      src = path.join(d.root, file);
      if (!fs.existsSync(src)) { refuse(res, 404, "validation.not_found", "No such file."); return; }
      const dir = fs.mkdtempSync(path.join(d.root, ".peer-snap-"));
      tmp = dir;
      const out = path.join(dir, "copy.db");
      const s = openDb(src, { readOnly: true });
      try { s.exec(`VACUUM INTO '${out.replaceAll("'", "''")}'`); } finally { s.close(); }
      src = out;
    } else { refuse(res, 404, "validation.not_found", "No such file."); return; }
    if (!fs.existsSync(src)) { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); refuse(res, 404, "validation.not_found", "No such file."); return; }
    res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(fs.statSync(src).size), "cache-control": "no-store" });
    const rs = fs.createReadStream(src);
    rs.pipe(res);
    const done = (): void => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); };
    rs.on("close", done);
    rs.on("error", () => { done(); res.destroy(); });
  }

  // ---- the new computer

  interface Joining {
    s: string;
    username: string;
    offers: { slot: number; offer: Offer }[];
    chosen?: { target: PeerTarget; offer: Offer; requestId: string; poll: string; code: string; nonce: string; route: string };
    pkg?: JoinPackage;
  }
  let joining: Joining | null = null;

  const fetchFn = d.fetch ?? fetch;

  async function find(username: string): Promise<{ slot: number; offer: Offer }[]> {
    const s = newAskSecret();
    joining = { s, username, offers: [] };
    const r = await fetchFn(`${httpBase(d.relayUrl)}/v1/signin`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ loc: await nameLocator(username), s }) });
    if (r.status === 429) throw Object.assign(new Error("Too many tries for that name. Wait a minute and try again."), { code: "rate_limit.exceeded" });
    if (r.status >= 400) throw Object.assign(new Error("Could not reach Vyre's relay. Check the connection and try again."), { code: "provider.unavailable" });
    const left = new Set(Array.from({ length: SLOTS }, (_, i) => i));
    for (const wait of [400, 700, 1000, 1400]) {
      await new Promise((r2) => setTimeout(r2, wait));
      for (const slot of [...left]) {
        const got = await fetchFn(`${httpBase(d.relayUrl)}/v1/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ loc: await ticketLocator(s, slot) }) }).catch(() => null);
        if (!got || got.status === 404) continue;
        left.delete(slot);
        if (got.status !== 200) continue;
        const offer = await openOffer(s, slot, (await got.json()) as { record: string; mac: string });
        if (offer && joining?.s === s) joining.offers.push({ slot, offer });
      }
      if (!left.size || (joining?.offers.length && wait >= 1300)) break;
    }
    return joining?.s === s ? joining.offers : [];
  }

  async function withTarget<T>(target: PeerTarget, run: (ch: PeerChannel) => Promise<T>): Promise<T> {
    const ch = await openPeerChannel(target, { ...(d.WebSocket ? { WebSocket: d.WebSocket } : {}), timeoutMs: 15_000 });
    try { return await run(ch); } finally { ch.close(); }
  }

  async function request(offerIndex: number, name: string, platform: string): Promise<{ code: string; name: string }> {
    const j = joining;
    const pick = j?.offers[offerIndex];
    if (!j || !pick) throw Object.assign(new Error("Find your Personal Space first."), { code: "validation.precondition_failed" });
    const keys = loadRelayKeys(d.root);
    const route = await routeIdOf(keys.routePub);
    const nonce = b64u(globalThis.crypto.getRandomValues(new Uint8Array(18)));
    const target: PeerTarget = { relay: pick.offer.relay, route: pick.offer.route, box: fromB64u(pick.offer.box) };
    const out = await withTarget(target, async (ch) => {
      const r = await ch.request({ method: "POST", path: "/v1/peers/enrol", headers: { "content-type": "application/json" }, body: JSON.stringify({ s: j.s, nonce, route, name, platform }) });
      const body = r.json<{ data?: { requestId: string; poll: string; code: string }; error?: { code: string; message: string } }>();
      if (r.status !== 200 || !body.data) throw Object.assign(new Error(body.error?.message ?? "That computer did not take the request."), { code: body.error?.code ?? "provider.unavailable" });
      return body.data;
    });
    const mine = await confirmCode(j.s, nonce);
    if (mine !== out.code) throw Object.assign(new Error("That computer answered with the wrong code."), { code: "auth.invalid_code" });
    j.chosen = { target, offer: pick.offer, requestId: out.requestId, poll: out.poll, code: out.code, nonce, route };
    return { code: out.code, name: pick.offer.name };
  }

  async function status(): Promise<Record<string, unknown>> {
    const c = joining?.chosen;
    if (!joining || !c) throw Object.assign(new Error("No request is waiting."), { code: "validation.precondition_failed" });
    if (joining.pkg) return { state: "allowed", bundle: joining.pkg.bundle, username: joining.pkg.username, space: joining.pkg.space, spaceName: joining.pkg.spaceName, from: c.offer.name };
    const out = await withTarget(c.target, async (ch) => {
      const r = await ch.request({ method: "POST", path: "/v1/peers/enrol/status", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: c.requestId, poll: c.poll }) });
      const body = r.json<{ data?: { state: string; package?: JoinPackage }; error?: { message: string } }>();
      if (r.status !== 200 || !body.data) throw Object.assign(new Error(body.error?.message ?? "That computer did not answer."), { code: "provider.unavailable" });
      return body.data;
    });
    if (out.state === "allowed" && out.package) {
      if (out.package.space !== c.offer.space) throw Object.assign(new Error("That computer answered for a different Space."), { code: "auth.invalid_code" });
      joining.pkg = out.package;
      return { state: "allowed", bundle: out.package.bundle, username: out.package.username, space: out.package.space, spaceName: out.package.spaceName, from: c.offer.name };
    }
    return { state: out.state, from: c.offer.name };
  }

  /** Copy the Space from the computer that allowed this one into peer-join/, then stop so the shell starts the daemon again on the copy. */
  async function commit(): Promise<{ space: string }> {
    const j = joining, c = j?.chosen, pkg = j?.pkg;
    if (!j || !c || !pkg) throw Object.assign(new Error("Nothing to copy yet."), { code: "validation.precondition_failed" });
    const stage = path.join(d.root, JOIN_DIR);
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(path.join(stage, "blobs"), { recursive: true, mode: 0o700 });
    const auth = { authorization: `Peer ${pkg.token}` };
    await withTarget(c.target, async (ch) => {
      const get = async (file: string, to: string): Promise<void> => {
        const fd = fs.openSync(to, "w", 0o600);
        try {
          const r = await ch.request({ method: "GET", path: `/v1/peers/snapshot?file=${encodeURIComponent(file)}`, headers: auth, timeoutMs: 10 * 60_000, sink: (chunk) => { fs.writeSync(fd, chunk); } });
          if (r.status !== 200) throw Object.assign(new Error(`Could not copy ${file} from ${c.offer.name}.`), { code: "provider.unavailable" });
        } finally { fs.closeSync(fd); }
      };
      for (const f of STAGED_DBS) await get(f, path.join(stage, f));
      const list = await ch.request({ method: "GET", path: "/v1/peers/snapshot?file=blobs", headers: auth });
      const files = list.status === 200 ? list.json<{ data: { files: string[] } }>().data.files : [];
      for (const rel of files) {
        const safe = safeRel(rel);
        if (!safe) continue;
        fs.mkdirSync(path.dirname(path.join(stage, "blobs", safe)), { recursive: true });
        await get(`blobs/${safe}`, path.join(stage, "blobs", safe));
      }
      // the agents' git trees, so a repository works on this computer as it did on that one
      const trees = await ch.request({ method: "GET", path: "/v1/peers/snapshot?file=trees", headers: auth });
      for (const rel of trees.status === 200 ? trees.json<{ data: { files: string[] } }>().data.files : []) {
        const safe = safeRel(rel);
        if (!safe) continue;
        fs.mkdirSync(path.dirname(path.join(stage, "trees", safe)), { recursive: true });
        await get(`trees/${safe}`, path.join(stage, "trees", safe));
      }
    });
    for (const [f, text] of Object.entries(pkg.secrets)) if (SECRET_FILES.includes(f)) fs.writeFileSync(path.join(stage, f), text, { mode: 0o600 });
    const self = pkg.peers.find((p) => p.peerId === pkg.peerId);
    fs.writeFileSync(path.join(stage, "join.json"), JSON.stringify({ v: 1, space: pkg.space, peerId: pkg.peerId, token: pkg.token, box: pkg.box, relay: self?.relay ?? c.offer.relay, from: c.offer.name, at: d.now() }), { mode: 0o600 });
    // the desktop app reads the Personal Space's id from this marker on every start; the next start is the joined Space
    if (fs.existsSync(path.join(d.root, "personal-profile.json"))) fs.writeFileSync(path.join(d.root, "personal-profile.json"), JSON.stringify({ spaceId: pkg.space }), { mode: 0o600 });
    fs.writeFileSync(path.join(stage, "ready"), "1", { mode: 0o600 });
    d.log("peers.joined", { space: pkg.space, from: c.offer.name });
    joining = null;
    setTimeout(() => d.restart(), 200).unref?.();
    return { space: pkg.space };
  }

  async function local(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    const h = db();
    if (!fromOwnApp(req)) { refuse(res, 403, "permission.denied", "Only this computer's own app can do that."); return; }
    if (!d.enabled || !h) { refuse(res, 404, "validation.not_found", "This Space cannot join another computer's Personal Space."); return; }
    if (claimed(h)) { refuse(res, 409, "validation.precondition_failed", "This computer already has its own Personal Space with an owner."); return; }
    const b = (await readBody(req)) ?? {};
    try {
      switch (url.pathname) {
        case "/local/peers/find": {
          const username = str(b["username"]).trim();
          if (!/^[A-Za-z0-9._-]{1,64}$/.test(username)) { refuse(res, 400, "validation.bad_input", "Type your Vyre username."); return; }
          const offers = await find(username);
          json(res, 200, { data: { offers: offers.map((o, i) => ({ index: i, name: o.offer.name, space: o.offer.space })) } });
          return;
        }
        case "/local/peers/request": json(res, 200, { data: await request(Number(b["index"] ?? 0), str(b["name"]).trim().slice(0, 60) || d.name, d.platform) }); return;
        case "/local/peers/status": json(res, 200, { data: await status() }); return;
        case "/local/peers/commit": json(res, 200, { data: await commit() }); return;
        case "/local/peers/cancel": joining = null; json(res, 200, { data: { cancelled: true } }); return;
        default: refuse(res, 404, "validation.not_found", "No such route.");
      }
    } catch (e) {
      const code = str((e as { code?: unknown }).code) || "provider.unavailable";
      refuse(res, code === "rate_limit.exceeded" ? 429 : code.startsWith("validation") ? 409 : 502, code, (e as Error).message);
    }
  }

  function handle(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    const url = new URL(req.url ?? "/", "http://vyred");
    if (url.pathname.startsWith("/local/peers/") && req.method === "POST") { void local(req, res, url); return true; }
    if (url.pathname === "/v1/peers/enrol" && req.method === "POST") { void enrol(req, res); return true; }
    if (url.pathname === "/v1/peers/enrol/status" && req.method === "POST") { void enrolStatus(req, res); return true; }
    if (url.pathname === "/v1/peers/snapshot" && req.method === "GET") { void snapshot(req, res, url); return true; }
    return peerSync.handle(req, res, peerOf);
  }

  if (d.enabled) {
    timer = setInterval(() => { void tick().catch(() => {}); }, TICK_MS);
    timer.unref?.();
  }
  return { onAsk, handle, tick, sync: peerSync, stop: () => { if (timer) clearInterval(timer); timer = null; peerSync.stop(); void selfRoute; } };
}
