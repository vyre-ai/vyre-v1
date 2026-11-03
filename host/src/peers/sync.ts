// Computers of one Personal Space keeping each other's copy up to date (lane l-multidevice, increments 2 and 3). The copy on each computer is its own databases; what moves is cells
// (sync/src/peers/cells.ts, which the sync module hands the host, since host may not import sync). Every few seconds each computer asks every other computer it can reach for the rows that
// changed since it last asked, over the end-to-end channel through the relay, and merges them. No computer is the home: whichever are awake sync with each other, a change made on a computer
// that was offline goes out the next time it reaches one, and a change goes on through any computer to the rest.
// Asked with the computer's token (Authorization: Peer vpt_...). The `since` a computer sends is also its receipt: what is left after it is what "changes waiting" counts.
// Two stores: modules.db (every module's tables) and space.db (records). Blobs (file contents and attachments) are named by content: a computer fetches the ones it does not have.
import fs from "node:fs";
import path from "node:path";
import type http from "node:http";
import type { HostDb } from "../daemon/sqlite.ts";
import { openDb } from "../daemon/sqlite.ts";
import { loadRelayKeys } from "../seams/relay.ts";
import { openPeerChannel } from "./link.ts";
import { LEASE_ID, LEASE_MS, RENEW_MS, decide } from "./runner.ts";
import type { Lease } from "./runner.ts";
import type { PeerChannel, PeerTarget } from "./link.ts";

/** The part of sync/src/peers/cells.ts the host uses (a structural copy: host may not import sync). */
export interface CellsLike {
  install(): string[];
  stamp(): number;
  changes(since: number, limit?: number): { rows: unknown[]; next: number; more: boolean; head: number };
  apply(rows: readonly unknown[]): { applied: number; unchanged: number; refused: { t: string; k: string; why: string }[]; conflicts: { t: string; k: string; col: string; from: string; to: string; renamed: string; kept: string; why?: string; otherKey?: string }[] };
  head(): number;
  waiting(cursor: number): number;
  cursor(peer: string): number;
  setCursor(peer: string, cursor: number): void;
}
export type CreateCells = (db: { all(sql: string, ...a: unknown[]): unknown[]; run(sql: string, ...a: unknown[]): unknown; exec(sql: string): void }, o: { site: string; now(): number; deny?(t: string): boolean; denyColumns?: Record<string, readonly string[]> }) => CellsLike;

/** Tables that describe this computer, or are kept from this computer's own log by sequence, and never travel. The engine's queue, leases and parked turns are work this computer's own engine
 *  holds: copied, another computer's engine would take a turn that is already running here (a chat message itself travels; the turn it started stays where it was sent). */
const LOCAL = /^(host_|health_|logs_|sync_|search_|network_(phone|endpoint|config|command|result|dns|cert|peer_request|peer_self|peer_conflict|peer_invite)|engine_(thread_queue|thread_lease|waits|crew_job|crew_wait|capture_state))/;
export const denyModules = (t: string): boolean => LOCAL.test(t);
export const DENY_COLUMNS: Readonly<Record<string, readonly string[]>> = { network_peer: ["last_seen_at"] };

const ROUND_MS = 5_000;
const BACKOFF_MS = 15_000;
const BLOBS_EVERY = 6;
const PAGE = 500;
export const STORES = ["modules", "space"] as const;
export type StoreName = typeof STORES[number];

export interface PeerSyncDeps {
  root: string;
  db: () => HostDb | null;
  createCells: () => CreateCells | null;
  selfId: () => string | null;
  token: () => string | null;
  now: () => number;
  log: (msg: string, attrs?: Record<string, unknown>) => void;
  /** rows changed here with no event of this computer's: tell the open apps to re-read */
  changed: () => void;
  WebSocket?: typeof WebSocket;
  roundMs?: number;
  /** how long the runner lease lasts (runner.ts); tests make it short */
  leaseMs?: number;
}

export interface PeerSync {
  /** start capturing changes (once the Space has a second computer) */
  ensure(): boolean;
  /** one pass over every other computer */
  round(): Promise<{ reached: string[]; applied: number }>;
  handle(req: http.IncomingMessage, res: http.ServerResponse, peerOf: (req: http.IncomingMessage) => Promise<string | null>): boolean;
  /** rows written here that some other computer has not taken yet */
  waiting(): number;
  /** This computer runs the Space's scheduled work now (runner.ts). Always true for a Space on one computer. */
  isRunner(): boolean;
  /** take or renew the lease now (the rounds do it every 30 s) */
  lease(): RunnerState;
  /** sync on a timer while the daemon runs */
  start(): void;
  stop(): void;
}

interface PeerRow { id: string; name: string; route: string; relay: string }
export interface RunnerState { holder: string | null; mine: boolean; expiresAt: number }

export function createPeerSync(d: PeerSyncDeps): PeerSync {
  let cells: Record<StoreName, CellsLike> | null = null;
  let spaceDb: HostDb | null = null;
  const channels = new Map<string, PeerChannel>();
  const backoff = new Map<string, number>();
  let rounds = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let leasedAt = 0;

  const leaseRow = (h: HostDb): Lease | null => (h.all("SELECT peer_id, kind, since, expires_at FROM network_runner WHERE id = ?", LEASE_ID)[0] as Lease | undefined) ?? null;
  function lease(): RunnerState {
    const h = d.db(), me = d.selfId();
    if (!h || !me || !cells) return { holder: me, mine: true, expiresAt: Infinity };
    const now = d.now();
    const kind = String((h.all("SELECT kind FROM network_peer WHERE id = ?", me)[0] as { kind?: string } | undefined)?.kind ?? "computer");
    const serverAwake = (h.all("SELECT 1 FROM network_peer WHERE kind = 'server' AND id != ? AND removed_at IS NULL AND last_seen_at > ?", me, now - 2 * 60_000) as unknown[]).length > 0;
    const cur = leaseRow(h);
    const move = decide({ id: me, kind }, cur, now, serverAwake);
    const ttl = d.leaseMs ?? LEASE_MS;
    if (move === "renew") h.run("UPDATE network_runner SET expires_at = ? WHERE id = ? AND peer_id = ?", now + ttl, LEASE_ID, me);
    else if (move === "take") {
      h.run("INSERT INTO network_runner (id, peer_id, kind, since, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET peer_id = excluded.peer_id, kind = excluded.kind, since = excluded.since, expires_at = excluded.expires_at", LEASE_ID, me, kind, now, now + ttl);
      d.log("peers.runner_taken", { from: cur?.peer_id ?? null });
    }
    leasedAt = now;
    const after = leaseRow(h);
    return { holder: after?.peer_id ?? null, mine: after?.peer_id === me && (after?.expires_at ?? 0) > now, expiresAt: after?.expires_at ?? 0 };
  }
  function isRunner(): boolean {
    // a Space on one computer runs everything here; one that has a second computer decides by the lease, and a computer that has not taken it waits
    if (!cells && !ensure()) return true;
    const h = d.db(), me = d.selfId();
    if (!h || !me) return true;
    const cur = leaseRow(h);
    return Boolean(cur && cur.peer_id === me && cur.expires_at > d.now());
  }

  const peers = (h: HostDb): PeerRow[] => (h.all("SELECT id, name, route, relay FROM network_peer WHERE removed_at IS NULL") as PeerRow[]);

  function ensure(): boolean {
    if (cells) return true;
    const h = d.db(), make = d.createCells(), site = d.selfId();
    if (!h || !make || !site) return false;
    if (peers(h).length < 2) return false;
    try {
      const space = path.join(d.root, "space.db");
      spaceDb = fs.existsSync(space) ? openDb(space) : null;
      const c: Partial<Record<StoreName, CellsLike>> = { modules: make(h, { site, now: d.now, deny: denyModules, denyColumns: DENY_COLUMNS }) };
      if (spaceDb) c.space = make(spaceDb, { site, now: d.now, deny: (t) => t.startsWith("sync_") });
      for (const x of Object.values(c)) x.install();
      cells = c as Record<StoreName, CellsLike>;
      d.log("peers.capture_on", {});
      return true;
    } catch (e) { d.log("peers.capture_failed", { why: (e as Error).message }); return false; }
  }

  async function channel(p: PeerRow): Promise<PeerChannel> {
    const have = channels.get(p.id);
    if (have && !have.closed) return have;
    const box = loadRelayKeys(d.root).boxPub;
    const target: PeerTarget = { relay: p.relay, route: p.route, box };
    const ch = await openPeerChannel(target, { ...(d.WebSocket ? { WebSocket: d.WebSocket } : {}), timeoutMs: 10_000 });
    channels.set(p.id, ch);
    return ch;
  }

  async function fetchBlobs(ch: PeerChannel, auth: Record<string, string>): Promise<number> {
    const list = await ch.request({ method: "GET", path: "/v1/peers/snapshot?file=blobs", headers: auth });
    if (list.status !== 200) return 0;
    let got = 0;
    for (const rel of list.json<{ data: { files: string[] } }>().data.files) {
      const n = path.posix.normalize(rel);
      if (n.startsWith("..") || n.startsWith("/") || n.includes("\0")) continue;
      const to = path.join(d.root, "blobs", n);
      if (fs.existsSync(to)) continue;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      const tmp = `${to}.peer-part`;
      const fd = fs.openSync(tmp, "w", 0o600);
      let ok = false;
      try { ok = (await ch.request({ method: "GET", path: `/v1/peers/snapshot?file=${encodeURIComponent(`blobs/${n}`)}`, headers: auth, sink: (c) => { fs.writeSync(fd, c); }, timeoutMs: 5 * 60_000 })).status === 200; }
      finally { fs.closeSync(fd); }
      if (ok) { fs.renameSync(tmp, to); got++; } else fs.rmSync(tmp, { force: true });
    }
    return got;
  }

  async function round(): Promise<{ reached: string[]; applied: number }> {
    const out = { reached: [] as string[], applied: 0 };
    if (running || !ensure() || !cells) return out;
    running = true;
    try {
      const h = d.db(), me = d.selfId(), token = d.token();
      if (!h || !me || !token) return out;
      rounds++;
      const auth = { authorization: `Peer ${token}`, "content-type": "application/json" };
      for (const p of peers(h)) {
        if (p.id === me || !p.route) continue;
        if ((backoff.get(p.id) ?? 0) > d.now()) continue;
        try {
          const ch = await channel(p);
          for (const store of STORES) {
            const c = cells[store];
            if (!c) continue;
            for (;;) {
              const since = c.cursor(p.id);
              const r = await ch.request({ method: "POST", path: "/v1/peers/changes", headers: auth, body: JSON.stringify({ store, since, limit: PAGE }) });
              if (r.status !== 200) throw new Error(`changes answered ${r.status}`);
              const page = r.json<{ data: { rows: unknown[]; next: number; more: boolean } }>().data;
              const done = c.apply(page.rows);
              out.applied += done.applied;
              for (const x of done.conflicts) {
                const detail = x.kept === "aside" ? `Kept aside: ${x.why ?? "could not be merged"}` : `"${x.from}" was made on two computers; one is now "${x.to}"`;
                h.run("INSERT OR IGNORE INTO network_peer_conflict (id, store, tbl, row_key, kind, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?)", `pcf_${d.now()}_${Math.random().toString(36).slice(2, 10)}`, store, x.t, x.otherKey ?? x.k, x.kept === "aside" ? "kept_aside" : "renamed", detail, d.now());
              }
              if (done.refused.length) d.log("peers.refused", { from: p.id, store, n: done.refused.length, first: done.refused[0] });
              c.setCursor(p.id, page.next);
              if (!page.more) break;
            }
          }
          if (rounds % BLOBS_EVERY === 1) out.applied += await fetchBlobs(ch, auth);
          h.run("UPDATE network_peer SET last_seen_at = ? WHERE id = ?", d.now(), p.id);
          out.reached.push(p.id);
          backoff.delete(p.id);
        } catch (e) {
          channels.get(p.id)?.close();
          channels.delete(p.id);
          backoff.set(p.id, d.now() + BACKOFF_MS);
          d.log("peers.unreachable", { peer: p.id, why: (e as Error).message.slice(0, 120) });
        }
      }
      if (out.applied) d.changed();
      if (d.now() - leasedAt >= Math.min(RENEW_MS, (d.leaseMs ?? LEASE_MS) / 3)) lease();
      try { h.run("UPDATE network_peer_self SET waiting = ?, synced_at = ? WHERE id = 1", waiting(), out.reached.length ? d.now() : null); } catch { /* an older table */ }
      return out;
    } finally { running = false; }
  }

  function waiting(): number {
    if (!cells) return 0;
    const h = d.db(), me = d.selfId();
    if (!h || !me) return 0;
    const others = peers(h).filter((p) => p.id !== me).map((p) => p.id);
    if (!others.length) return 0;
    let n = 0;
    for (const store of STORES) {
      const c = cells[store];
      if (!c) continue;
      const acks = others.map((id) => c.cursor(`ack:${id}`));
      n += c.waiting(Math.min(...acks));
    }
    return n;
  }

  async function changes(req: http.IncomingMessage, res: http.ServerResponse, peerOf: (req: http.IncomingMessage) => Promise<string | null>): Promise<void> {
    const who = await peerOf(req);
    const send = (status: number, body: unknown): void => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
    if (!who) { send(401, { error: { code: "auth.unauthenticated", message: "This computer is not part of the Space." } }); return; }
    // a computer this one has never synced with asks first: start capturing now, so nothing it writes from here on is missed
    if (!ensure() || !cells) { send(409, { error: { code: "validation.precondition_failed", message: "This computer is not ready to sync yet." } }); return; }
    const parts: Buffer[] = [];
    for await (const c of req) parts.push(c as Buffer);
    let b: { store?: unknown; since?: unknown; limit?: unknown } = {};
    try { b = JSON.parse(Buffer.concat(parts).toString("utf8") || "{}") as typeof b; } catch { /* refused below */ }
    const store = STORES.find((s) => s === b.store);
    const since = Number(b.since), limit = Math.min(Math.max(Number(b.limit) || PAGE, 1), 2000);
    const c = store ? cells[store] : undefined;
    if (!store || !Number.isSafeInteger(since) || since < 0) { send(400, { error: { code: "validation.bad_input", message: "Name the store and where to start." } }); return; }
    if (!c) { send(200, { data: { rows: [], next: since, more: false, head: 0 } }); return; }
    c.setCursor(`ack:${who}`, since);
    // it is awake: ask it again on the next round rather than wait out a backoff from when it was asleep
    backoff.delete(who);
    const h = d.db();
    try { h?.run("UPDATE network_peer SET last_seen_at = ? WHERE id = ?", d.now(), who); } catch { /* closing */ }
    send(200, { data: c.changes(since, limit) });
  }

  return {
    ensure, round, waiting, isRunner, lease,
    handle(req, res, peerOf) {
      if (req.method === "POST" && (req.url ?? "").split("?")[0] === "/v1/peers/changes") { void changes(req, res, peerOf).catch(() => { try { res.writeHead(500); res.end(); } catch { /* sent */ } }); return true; }
      return false;
    },
    start() {
      if (timer) return;
      timer = setInterval(() => { void round().catch(() => {}); }, d.roundMs ?? ROUND_MS);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      for (const ch of channels.values()) ch.close();
      channels.clear();
      try { spaceDb?.close(); } catch { /* closed */ }
    },
  };
}
