// @ts-check
// The warmup pool (spec 2.19; ARCH 7.6, R19): an opt-in exchange across Spaces. A Space joins with the mailboxes that are warming; on each exchange it says how many
// peers it wants per mailbox and reports what happened since the last time; the pool answers with peers from other Spaces and with the health that peers reported about
// its own mailboxes. The pool never sees mail, only addresses, counts and key ids.
//
// createPoolService(options) returns handle({ method, path, headers, body }) -> { status, json }. server.js puts it behind node:http; tests call it directly.
// Rules the service keeps:
//   - a request is signed by the Space key (wire.js); join registers the key, exchange needs a joined key; replays and stale requests are refused
//   - a mailbox address belongs to one key at a time; a second key offering it is refused, so nobody can draw mail to an address they do not run
//   - peers always come from other Spaces, never the asker's own; the least loaded peer first, and no peer takes more than `inboundCap` warmup mails a day
//   - a mailbox whose peers report spam placement above `spamLimit` (with enough reports) is told to slow and is not handed out as a peer
//   - a key that does not exchange for `ttlMs` is dropped: that is how a Space that vanished leaves the pool
//   - one exchange per key per `minIntervalMs`
// Health about a mailbox is what its peers saw (`seen`: where its warmup mail landed, and whether the peer replied), kept for `windowMs`.

import { MAX_BODY, MAX_MAILBOXES, MAX_SKEW_MS, MAX_WANT, ADDRESS_RE, signedMessage, unb64url, keyId, verifySignature } from "./wire.js";

const DAY = 86_400_000;

/**
 * @typedef {{ address: string }} Offer
 * @typedef {{ id: string, offers: Offer[], joinedAt: number, lastExchangeAt: number }} Member
 * @typedef {{ at: number, outcome: "inbox" | "spam" | "missing", replied: boolean }} Report
 * @typedef {{ status: number, json: unknown }} Reply
 * @typedef {{ method: string, path: string, headers: Record<string, string | undefined>, body: string }} Request
 */

const ok = (/** @type {unknown} */ data) => ({ status: 200, json: { data } });
const no = (/** @type {number} */ status, /** @type {string} */ code, /** @type {string} */ message, /** @type {Record<string, unknown>} */ extra = {}) => ({ status, json: { error: { code, message, ...extra } } });

/**
 * @param {{ now?: () => number, ttlMs?: number, minIntervalMs?: number, inboundCap?: number, spamLimit?: number, minReports?: number, windowMs?: number }} [o]
 */
export function createPoolService(o = {}) {
  const now = o.now ?? (() => Date.now());
  const ttlMs = o.ttlMs ?? 2 * DAY;
  const minIntervalMs = o.minIntervalMs ?? 60_000;
  const inboundCap = o.inboundCap ?? 40;
  const spamLimit = o.spamLimit ?? 0.3;
  const minReports = o.minReports ?? 5;
  const windowMs = o.windowMs ?? 7 * DAY;

  /** @type {Map<string, Member>} */
  const members = new Map();
  /** address -> owning key id */
  const owner = new Map();
  /** address -> reports about mail from that address */
  /** @type {Map<string, Report[]>} */
  const reports = new Map();
  /** address -> { day, n } warmup mails assigned to it today */
  /** @type {Map<string, { day: number, n: number }>} */
  const inbound = new Map();
  /** nonce -> expiry */
  /** @type {Map<string, number>} */
  const nonces = new Map();

  function sweep() {
    const t = now();
    for (const [id, m] of members) {
      if (t - Math.max(m.joinedAt, m.lastExchangeAt) > ttlMs) drop(id);
    }
    for (const [n, until] of nonces) if (until <= t) nonces.delete(n);
    for (const [a, list] of reports) {
      const fresh = list.filter(r => t - r.at <= windowMs);
      if (fresh.length === 0) reports.delete(a); else if (fresh.length !== list.length) reports.set(a, fresh);
    }
  }

  function drop(/** @type {string} */ id) {
    const m = members.get(id);
    if (!m) return;
    for (const off of m.offers) if (owner.get(off.address) === id) { owner.delete(off.address); inbound.delete(off.address); }
    members.delete(id);
  }

  /** Spam share and reply share of what peers reported about one address. */
  function healthOf(/** @type {string} */ address) {
    const list = reports.get(address) ?? [];
    const landed = list.filter(r => r.outcome !== "missing");
    const spam = list.filter(r => r.outcome === "spam").length;
    return {
      reports: list.length,
      spamRate: landed.length === 0 ? 0 : spam / landed.length,
      replyRate: list.length === 0 ? 0 : list.filter(r => r.replied).length / list.length,
      missingRate: list.length === 0 ? 0 : list.filter(r => r.outcome === "missing").length / list.length,
    };
  }

  const flagged = (/** @type {string} */ address) => { const h = healthOf(address); return h.reports >= minReports && h.spamRate > spamLimit; };

  /** @returns {Promise<{ id: string, body: any } | Reply>} */
  async function authenticate(/** @type {Request} */ req) {
    const h = req.headers;
    const pub = unb64url(h["x-vyre-key"] ?? ""), sig = unb64url(h["x-vyre-sig"] ?? "");
    const ts = h["x-vyre-ts"] ?? "", nonce = h["x-vyre-nonce"] ?? "";
    if (!pub || pub.length !== 32 || !sig || sig.length !== 64 || !/^\d{10,16}$/.test(ts) || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) return no(401, "auth.invalid_signature", "The request is not signed by a Space key.");
    if (Math.abs(now() - Number(ts)) > MAX_SKEW_MS) return no(401, "auth.stale", "The request is too old or too new. Check the clock.");
    if (!(await verifySignature(pub, sig, signedMessage(req.method, req.path, ts, nonce, req.body)))) return no(401, "auth.invalid_signature", "The signature does not match the Space key.");
    const id = await keyId(pub);
    // a nonce is scoped to the key that used it, so two Spaces can never replay each other's by accident
    if (nonces.has(`${id}:${nonce}`)) return no(401, "auth.replayed", "That request was already used.");
    nonces.set(`${id}:${nonce}`, now() + 2 * MAX_SKEW_MS);
    let body;
    try { body = JSON.parse(req.body); } catch { return no(400, "validation.bad_input", "The body is not JSON."); }
    if (typeof body !== "object" || body === null || Array.isArray(body) || body.v !== 1 || !Array.isArray(body.mailboxes)) return no(400, "validation.bad_input", "Send { v: 1, mailboxes: [...] }.");
    if (body.mailboxes.length > MAX_MAILBOXES) return no(400, "validation.bad_input", `At most ${MAX_MAILBOXES} mailboxes.`);
    return { id, body };
  }

  /** @param {Request} req @returns {Promise<Reply>} */
  async function join(req) {
    const a = await authenticate(req);
    if ("status" in a) return a;
    /** @type {string[]} */
    const addresses = [];
    for (const m of a.body.mailboxes) {
      const address = typeof m?.address === "string" ? m.address.trim().toLowerCase() : "";
      if (!ADDRESS_RE.test(address) || address.length > 254) return no(400, "validation.bad_input", "A mailbox address is not valid.", { address: String(m?.address ?? "") });
      if (!addresses.includes(address)) addresses.push(address);
    }
    for (const address of addresses) {
      const taken = owner.get(address);
      if (taken !== undefined && taken !== a.id) return no(409, "validation.duplicate", "Another Space already offers that address.", { address });
    }
    const t = now();
    const had = members.get(a.id);
    if (addresses.length === 0) {
      drop(a.id);
      return ok({ joined: 0, left: had !== undefined, pool: poolSize() });
    }
    if (had) for (const off of had.offers) if (!addresses.includes(off.address)) { owner.delete(off.address); inbound.delete(off.address); }
    members.set(a.id, { id: a.id, offers: addresses.map(address => ({ address })), joinedAt: had?.joinedAt ?? t, lastExchangeAt: had?.lastExchangeAt ?? 0 });
    for (const address of addresses) owner.set(address, a.id);
    return ok({ joined: addresses.length, left: false, pool: poolSize() });
  }

  function poolSize() {
    let mailboxes = 0;
    for (const m of members.values()) mailboxes += m.offers.length;
    return { spaces: members.size, mailboxes };
  }

  /** @param {Request} req @returns {Promise<Reply>} */
  async function exchange(req) {
    const a = await authenticate(req);
    if ("status" in a) return a;
    const me = members.get(a.id);
    if (!me) return no(401, "auth.not_joined", "Join the pool first.");
    const t = now();
    if (me.lastExchangeAt !== 0 && t - me.lastExchangeAt < minIntervalMs) return no(429, "rate_limit.exceeded", "Exchange again later.", { retryAfterMs: minIntervalMs - (t - me.lastExchangeAt) });

    const own = new Set(me.offers.map(x => x.address));
    /** @type {{ address: string, want: number }[]} */
    const asks = [];
    for (const m of a.body.mailboxes) {
      const address = typeof m?.address === "string" ? m.address.trim().toLowerCase() : "";
      if (!own.has(address)) return no(400, "validation.bad_input", "That mailbox is not one this Space joined with.", { address: String(m?.address ?? "") });
      const want = m.want === undefined ? 0 : m.want;
      if (!Number.isInteger(want) || want < 0 || want > MAX_WANT) return no(400, "validation.bad_input", `want is a whole number from 0 to ${MAX_WANT}.`, { address });
      for (const s of Array.isArray(m.seen) ? m.seen.slice(0, 200) : []) {
        const from = typeof s?.from === "string" ? s.from.trim().toLowerCase() : "";
        if (!["inbox", "spam", "missing"].includes(s?.outcome)) return no(400, "validation.bad_input", "seen.outcome is inbox, spam or missing.", { address });
        const sender = owner.get(from);
        // a report is accepted only about mail from another Space's mailbox: a Space cannot vouch for its own
        if (sender === undefined || sender === a.id) continue;
        let list = reports.get(from);
        if (!list) { list = []; reports.set(from, list); }
        list.push({ at: t, outcome: s.outcome, replied: s.replied === true });
      }
      asks.push({ address, want });
    }
    me.lastExchangeAt = t;
    sweep();

    const day = Math.floor(t / DAY);
    /** peers from other Spaces, least loaded first, then by address so the answer is stable */
    const candidates = [];
    for (const m of members.values()) {
      if (m.id === a.id) continue;
      for (const off of m.offers) if (!flagged(off.address)) candidates.push(off.address);
    }
    const load = (/** @type {string} */ address) => { const x = inbound.get(address); return x && x.day === day ? x.n : 0; };
    const assignments = [];
    for (const ask of asks) {
      /** @type {string[]} */
      const peers = [];
      const pool = candidates.filter(c => load(c) < inboundCap).sort((x, y) => load(x) - load(y) || (x < y ? -1 : x > y ? 1 : 0));
      for (const c of pool) {
        if (peers.length >= ask.want) break;
        peers.push(c);
        inbound.set(c, { day, n: load(c) + 1 });
      }
      assignments.push({ address: ask.address, peers });
    }
    const health = asks.map(ask => {
      const h = healthOf(ask.address);
      return { address: ask.address, reports: h.reports, spamRate: round(h.spamRate), replyRate: round(h.replyRate), missingRate: round(h.missingRate), slow: flagged(ask.address) };
    });
    return ok({ assignments, health, nextAfterMs: minIntervalMs, pool: poolSize() });
  }

  /** @param {Request} req @returns {Promise<Reply>} */
  async function handle(req) {
    sweep();
    const path = req.path.split("?")[0] ?? "";
    if (path === "/health") return req.method === "GET" ? ok({ ok: true, ...poolSize() }) : no(405, "validation.bad_input", "GET only.");
    if (path !== "/v1/pool/join" && path !== "/v1/pool/exchange") return no(404, "validation.not_found", "No such call.");
    if (req.method !== "POST") return no(405, "validation.bad_input", "POST only.");
    if (new TextEncoder().encode(req.body).length > MAX_BODY) return no(413, "validation.too_large", "The body is too big.");
    return path === "/v1/pool/join" ? join({ ...req, path }) : exchange({ ...req, path });
  }

  return { handle, size: poolSize, healthOf };
}

const round = (/** @type {number} */ x) => Math.round(x * 10_000) / 10_000;
