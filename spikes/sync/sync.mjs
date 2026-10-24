// Sync spike engine: server-authoritative op-log on node:sqlite, device replica client.
// Throwaway spike code. The real package is @vyre/sync; this proves the shape of ARCHITECTURE-V1 section 5.
import { DatabaseSync } from "node:sqlite";

export const PROTECTED = new Set(["status", "money", "owner", "locked"]);
export const FIELD_LABEL = { salary: 2, ssn: 3 }; // rank above person clearance is filtered out of pull
const SKEW_MS = 5 * 60 * 1000;

export const hlcStr = (ms, c, dev) => `${ms.toString(16).padStart(12, "0")}-${c.toString(16).padStart(4, "0")}-${dev}`;
export const hlcParse = (h) => { const [m, c] = h.split("-"); return [parseInt(m, 16), parseInt(c, 16)]; };
export class Clock {
  constructor(dev, now = () => Date.now()) { this.dev = dev; this.now = now; this.ms = 0; this.c = 0; }
  tick() { const w = this.now(); if (w > this.ms) { this.ms = w; this.c = 0; } else this.c++; return hlcStr(this.ms, this.c, this.dev); }
  observe(h) { const [m, c] = hlcParse(h); if (m > this.ms || (m === this.ms && c > this.c)) { this.ms = m; this.c = c; } }
}

const SCHEMA = `
PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, op_id TEXT, kind TEXT, id TEXT, person TEXT, actor TEXT, fields TEXT);
CREATE TABLE IF NOT EXISTS rows(id TEXT, field TEXT, v TEXT, hlc TEXT, actor TEXT, seq INTEGER, key TEXT, nonce TEXT, PRIMARY KEY(id, field)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS row_meta(id TEXT PRIMARY KEY, owner TEXT, enc INTEGER DEFAULT 0, kind TEXT DEFAULT 'row');
CREATE TABLE IF NOT EXISTS acl(person TEXT, id TEXT, PRIMARY KEY(person, id)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS acl_id ON acl(id);
CREATE TABLE IF NOT EXISTS seen(person TEXT, dev TEXT, id TEXT, PRIMARY KEY(person, dev, id)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS field_history(n INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT, field TEXT, v TEXT, hlc TEXT, actor TEXT, seq INTEGER, reason TEXT);
CREATE TABLE IF NOT EXISTS conflicts(n INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT, field TEXT, ours TEXT, theirs TEXT, base INTEGER, ours_actor TEXT, theirs_actor TEXT, state TEXT DEFAULT 'open');
CREATE TABLE IF NOT EXISTS idem(op_id TEXT PRIMARY KEY, result TEXT) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS persons(person TEXT PRIMARY KEY, epoch INTEGER DEFAULT 0, clearance INTEGER DEFAULT 1) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ev_ydoc ON events(id, kind);
`;

export class Server {
  constructor(path = ":memory:", { now = () => Date.now() } = {}) {
    this.db = new DatabaseSync(path); this.now = now; this._c = new Map(); this.inTx = false;
    this.db.exec(SCHEMA);
  }
  p(sql) { let s = this._c.get(sql); if (!s) { s = this.db.prepare(sql); this._c.set(sql, s); } return s; }
  tx(fn) { if (this.inTx) return fn(); this.db.exec("BEGIN"); this.inTx = true; try { const r = fn(); this.db.exec("COMMIT"); return r; } catch (e) { this.db.exec("ROLLBACK"); throw e; } finally { this.inTx = false; } }
  close() { this.db.close(); }
  head() { return this.p("SELECT COALESCE(MAX(seq),0) AS h FROM events").get().h; }
  serverHlc() { return hlcStr(this.now(), 0, "server"); }

  addPerson(person, clearance = 1) { this.p("INSERT OR REPLACE INTO persons(person, epoch, clearance) VALUES(?, COALESCE((SELECT epoch FROM persons WHERE person=?),0), ?)").run(person, person, clearance); }
  person(person) { let r = this.p("SELECT * FROM persons WHERE person=?").get(person); if (!r) { this.addPerson(person); r = this.p("SELECT * FROM persons WHERE person=?").get(person); } return r; }
  bumpEpoch(person) { this.person(person); this.p("UPDATE persons SET epoch=epoch+1 WHERE person=?").run(person); }
  epoch(person) { return this.person(person).epoch; }

  hasAcl(person, id) { return !!this.p("SELECT 1 FROM acl WHERE person=? AND id=?").get(person, id); }
  visible(person, id) {
    const m = this.p("SELECT owner, enc FROM row_meta WHERE id=?").get(id);
    if (!m) return false;
    if (m.enc && m.owner !== person) return false; // E2E rows ride only to the owner
    return this.hasAcl(person, id);
  }
  ev(kind, id, person, actor, fields, opId = null) { return Number(this.p("INSERT INTO events(op_id, kind, id, person, actor, fields) VALUES(?,?,?,?,?,?)").run(opId, kind, id, person, actor, fields == null ? null : JSON.stringify(fields)).lastInsertRowid); }
  grant(person, id, by = "admin") { this.person(person); this.tx(() => { this.p("INSERT OR IGNORE INTO acl(person,id) VALUES(?,?)").run(person, id); this.ev("grant", id, person, by, null); }); }
  revoke(person, id, by = "admin") { this.tx(() => { this.p("DELETE FROM acl WHERE person=? AND id=?").run(person, id); this.ev("revoke", id, person, by, null); }); }

  clamp(hlc) { const [ms, c] = hlcParse(hlc); const lim = this.now() + SKEW_MS; if (ms > lim) return { hlc: hlcStr(this.now(), c, hlc.split("-").slice(2).join("-")), skew: ms - this.now() }; return { hlc, skew: 0 }; }

  history(r, reason) { this.p("INSERT INTO field_history(id,field,v,hlc,actor,seq,reason) VALUES(?,?,?,?,?,?,?)").run(r.id, r.field, r.v, r.hlc, r.actor, r.seq, reason); }

  // ops: [{opId, hlc, id, kind?:'row'|'doc', fields:{f:{v,key?,nonce?}}, baseSeq:{f:n}, enc?:bool}]
  push(person, ops) {
    const out = { applied: [], rejected: [], conflicts: [], serverHlc: null };
    this.person(person);
    this.tx(() => {
      for (const op of ops) {
        const prev = this.p("SELECT result FROM idem WHERE op_id=?").get(op.opId);
        if (prev) { const r = JSON.parse(prev.result); (r.kind === "applied" ? out.applied : out.rejected).push(r.v); continue; }
        const res = this.applyOp(person, op, out);
        this.p("INSERT INTO idem(op_id,result) VALUES(?,?)").run(op.opId, JSON.stringify(res));
        (res.kind === "applied" ? out.applied : out.rejected).push(res.v);
      }
    });
    out.serverHlc = this.serverHlc();
    return out;
  }
  applyOp(person, op, out) {
    const clearance = this.person(person).clearance;
    let m = this.p("SELECT owner, enc FROM row_meta WHERE id=?").get(op.id);
    if (!m) { this.p("INSERT INTO row_meta(id, owner, enc, kind) VALUES(?,?,?,?)").run(op.id, person, op.enc ? 1 : 0, op.kind || "row"); this.p("INSERT OR IGNORE INTO acl(person,id) VALUES(?,?)").run(person, op.id); this.ev("grant", op.id, person, person, null); }
    else if (!this.visible(person, op.id)) return { kind: "rejected", v: { opId: op.opId, reason: "denied", copyOut: op.fields } };
    for (const f of Object.keys(op.fields || {})) if ((FIELD_LABEL[f] || 0) > clearance) return { kind: "rejected", v: { opId: op.opId, reason: "label", copyOut: op.fields } };
    const { hlc, skew } = this.clamp(op.hlc);
    if (op.kind === "doc") { const seq = this.ev("ydoc", op.id, person, person, op.fields, op.opId); return { kind: "applied", v: { opId: op.opId, seq, skew } }; }
    const won = {}; const replaced = [];
    for (const f of Object.keys(op.fields || {})) {
      const fv = op.fields[f]; const cur = this.p("SELECT * FROM rows WHERE id=? AND field=?").get(op.id, f);
      const incV = JSON.stringify(fv.v); const base = (op.baseSeq && op.baseSeq[f]) || 0;
      const inc = { id: op.id, field: f, v: incV, hlc, actor: person, key: fv.key || null, nonce: fv.nonce || null };
      if (!cur) { won[f] = inc; continue; }
      if (PROTECTED.has(f)) {
        if (cur.seq > base && cur.v !== incV) {
          const evOp = (this.p("SELECT op_id FROM events WHERE seq=?").get(cur.seq) || {}).op_id;
          const chained = op.after && op.after[f] && op.after[f] === evOp; // my own previous queued op, not a concurrent writer
          if (!chained) {
            this.p("INSERT INTO conflicts(id,field,ours,theirs,base,ours_actor,theirs_actor) VALUES(?,?,?,?,?,?,?)").run(op.id, f, cur.v, incV, base, cur.actor, person);
            this.ev("conflict.opened", op.id, person, person, { field: f, ours: cur.v, theirs: incV });
            out.conflicts.push({ opId: op.opId, id: op.id, field: f });
            continue;
          }
        }
        if (cur.v !== incV) { replaced.push(cur); won[f] = inc; }
        continue;
      }
      if (hlc > cur.hlc || (hlc === cur.hlc && person > cur.actor)) { replaced.push(cur); won[f] = inc; }
      else this.history({ ...inc, seq: cur.seq }, "lww_loser");
    }
    let seq = this.head();
    if (Object.keys(won).length) {
      const evFields = {}; for (const f of Object.keys(won)) evFields[f] = { v: JSON.parse(won[f].v), hlc, actor: person, key: won[f].key, nonce: won[f].nonce };
      seq = this.ev(op.kind === "doc" ? "ydoc" : "set", op.id, person, person, evFields, op.opId);
      for (const r of replaced) this.history(r, "lww_loser");
      for (const f of Object.keys(won)) this.p("INSERT OR REPLACE INTO rows(id,field,v,hlc,actor,seq,key,nonce) VALUES(?,?,?,?,?,?,?,?)").run(op.id, f, won[f].v, hlc, person, seq, won[f].key, won[f].nonce);
    }
    return { kind: "applied", v: { opId: op.opId, seq, skew } };
  }

  filterFields(person, fields) {
    const cl = this.person(person).clearance; const o = {};
    for (const f of Object.keys(fields)) if ((FIELD_LABEL[f] || 0) <= cl) o[f] = fields[f];
    return o;
  }
  rowFields(person, id) {
    const o = {};
    for (const r of this.p("SELECT * FROM rows WHERE id=?").all(id)) o[r.field] = { v: JSON.parse(r.v), hlc: r.hlc, actor: r.actor, seq: r.seq, key: r.key, nonce: r.nonce };
    return this.filterFields(person, o);
  }
  docUpdates(id, upto) { return this.p("SELECT seq, fields FROM events WHERE id=? AND kind='ydoc' AND seq<=? ORDER BY seq").all(id, upto); }

  // Filtered pull by cursor. seen(person,id) makes 'became visible' and 'stopped being visible' exact.
  pull(person, { cursor = 0, epoch = 0, limit = 2000, dev = "d" } = {}) {
    const P = this.person(person);
    if (epoch < P.epoch) return { reset: "purge", epoch: P.epoch, changes: [], next: 0, more: false, serverHlc: this.serverHlc() };
    const scan = this.p("SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT ?").all(cursor, limit);
    const changes = [];
    this.tx(() => {
      for (const e of scan) {
        if (e.kind === "conflict.opened") continue;
        if ((e.kind === "grant" || e.kind === "revoke") && e.person !== person) continue;
        const vis = this.visible(person, e.id);
        const was = !!this.p("SELECT 1 FROM seen WHERE person=? AND dev=? AND id=?").get(person, dev, e.id);
        const meta = this.p("SELECT kind FROM row_meta WHERE id=?").get(e.id);
        if (vis && !was) {
          this.p("INSERT OR IGNORE INTO seen(person,dev,id) VALUES(?,?,?)").run(person, dev, e.id);
          if (meta && meta.kind === "doc") for (const u of this.docUpdates(e.id, this.head())) changes.push({ seq: e.seq, id: e.id, op: "ydoc", fields: JSON.parse(u.fields) });
          else changes.push({ seq: e.seq, id: e.id, op: "upsert", fields: this.rowFields(person, e.id) });
        } else if (vis && was) {
          if (e.kind === "set") changes.push({ seq: e.seq, id: e.id, op: "patch", fields: this.filterFields(person, JSON.parse(e.fields)) });
          else if (e.kind === "ydoc") changes.push({ seq: e.seq, id: e.id, op: "ydoc", fields: JSON.parse(e.fields) });
        } else if (!vis && was) {
          this.p("DELETE FROM seen WHERE person=? AND dev=? AND id=?").run(person, dev, e.id);
          changes.push({ seq: e.seq, id: e.id, op: "hide", fields: {} });
        }
      }
    });
    const next = scan.length ? scan[scan.length - 1].seq : cursor;
    return { epoch: P.epoch, changes, next, more: scan.length === limit, serverHlc: this.serverHlc(), head: this.head() };
  }

  snapshotBegin(person) { this.person(person); return { asOf: this.head(), epoch: this.epoch(person) }; }
  snapshotPage(person, { after = "", limit = 5000, dev = "d" } = {}) {
    const ids = this.p("SELECT a.id FROM acl a JOIN row_meta m ON m.id=a.id WHERE a.person=? AND a.id>? AND (m.enc=0 OR m.owner=?) ORDER BY a.id LIMIT ?").all(person, after, person, limit).map((r) => r.id);
    const cl = this.person(person).clearance; const rows = [];
    this.tx(() => {
      for (const id of ids) {
        this.p("INSERT OR IGNORE INTO seen(person,dev,id) VALUES(?,?,?)").run(person, dev, id);
        const m = this.p("SELECT kind FROM row_meta WHERE id=?").get(id);
        if (m.kind === "doc") { rows.push({ id, doc: this.docUpdates(id, this.head()).map((u) => JSON.parse(u.fields)) }); continue; }
        const f = {};
        for (const r of this.p("SELECT * FROM rows WHERE id=?").all(id)) if ((FIELD_LABEL[r.field] || 0) <= cl) f[r.field] = { v: JSON.parse(r.v), hlc: r.hlc, actor: r.actor, seq: r.seq, key: r.key, nonce: r.nonce };
        rows.push({ id, fields: f });
      }
    });
    return { rows, last: ids.length ? ids[ids.length - 1] : null, done: ids.length < limit };
  }
  // Bulk loader for benchmarks: ids visible to `person`, n rows with 4 fields each, no per-op overhead.
  bulkLoad(person, n, mk = (i) => ({ title: "row " + i, status: "open", amount: i, note: "note " + i })) {
    this.person(person);
    this.tx(() => {
      for (let i = 0; i < n; i++) {
        const id = "r" + String(i).padStart(7, "0"); const f = mk(i); const hlc = hlcStr(1000, i % 65535, "load");
        this.p("INSERT INTO row_meta(id,owner) VALUES(?,?)").run(id, person); this.p("INSERT INTO acl(person,id) VALUES(?,?)").run(person, id);
        const seq = this.ev("set", id, person, person, Object.fromEntries(Object.entries(f).map(([k, v]) => [k, { v, hlc, actor: person }])));
        for (const [k, v] of Object.entries(f)) this.p("INSERT INTO rows(id,field,v,hlc,actor,seq) VALUES(?,?,?,?,?,?)").run(id, k, JSON.stringify(v), hlc, person, seq);
      }
    });
  }
}

// ---- transports ----
export const direct = (server, person) => ({
  push: async (ops) => JSON.parse(JSON.stringify(server.push(person, JSON.parse(JSON.stringify(ops))))),
  pull: async (a) => JSON.parse(JSON.stringify(server.pull(person, a))),
  snapshotBegin: async () => server.snapshotBegin(person),
  snapshotPage: async (a) => JSON.parse(JSON.stringify(server.snapshotPage(person, a))),
});

// ---- device replica ----
export class Client {
  constructor({ dev, person, db, codec = null, e2eKeys = null, fts = false, now }) {
    this.dev = dev; this.person = person; this.db = db; this.codec = codec; this.e2eKeys = e2eKeys; this.useFts = fts;
    this.clock = new Clock(dev, now); this.n = 0; this.subs = new Map(); this.lock = Promise.resolve(); this.epoch = 0; this.cursor = 0;
  }
  async init() {
    await this.db.exec(`CREATE TABLE IF NOT EXISTS rows(id TEXT, field TEXT, v TEXT, hlc TEXT, seq INTEGER, pending INTEGER DEFAULT 0, key TEXT, nonce TEXT, base INTEGER DEFAULT 0, last_op TEXT, PRIMARY KEY(id, field));
      CREATE TABLE IF NOT EXISTS pending_ops(n INTEGER PRIMARY KEY AUTOINCREMENT, op_id TEXT UNIQUE, body TEXT);
      CREATE TABLE IF NOT EXISTS sync_state(k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS hidden(id TEXT PRIMARY KEY, seq INTEGER);
      CREATE TABLE IF NOT EXISTS rejected(op_id TEXT PRIMARY KEY, body TEXT);
      CREATE TABLE IF NOT EXISTS docs(id TEXT, n INTEGER, u TEXT, PRIMARY KEY(id, n));`);
    if (this.useFts) await this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(id UNINDEXED, body)");
    return this;
  }
  enc(s) { return this.codec ? this.codec.enc(s) : s; }
  dec(s) { return this.codec ? this.codec.dec(s) : s; }
  tx(fn) { const run = this.lock.then(async () => { await this.db.exec("BEGIN"); try { const r = await fn(); await this.db.exec("COMMIT"); return r; } catch (e) { await this.db.exec("ROLLBACK"); throw e; } }); this.lock = run.catch(() => {}); return run; }
  subscribe(id, cb) { let s = this.subs.get(id); if (!s) this.subs.set(id, (s = new Set())); s.add(cb); return () => s.delete(cb); }
  subscribeAll(cb) { return this.subscribe("*", cb); }
  notify(ids) { for (const id of ids) { const s = this.subs.get(id); if (s) for (const cb of s) cb(id); } const a = this.subs.get("*"); if (a) for (const cb of a) cb(ids); }

  async edit(id, fields, { e2e = false, kind = "row" } = {}) {
    const hlc = this.clock.tick(); const opId = `${this.dev}-${++this.n}`; const ids = [id];
    await this.tx(async () => {
      const baseSeq = {}; const wire = {}; const after = {};
      for (const f of Object.keys(fields)) {
        const r = await this.db.get("SELECT seq, pending, base, last_op FROM rows WHERE id=? AND field=?", [id, f]);
        baseSeq[f] = r ? (r.pending ? r.base : r.seq) : 0; if (r && r.pending && r.last_op) after[f] = r.last_op;
        let v = fields[f], key = null, nonce = null;
        if (e2e) { const x = this.e2eKeys.enc(JSON.stringify(v)); v = x.ct; key = x.key; nonce = x.nonce; }
        wire[f] = { v, key, nonce };
        await this.db.run("INSERT INTO rows(id,field,v,hlc,seq,pending,key,nonce,base,last_op) VALUES(?,?,?,?,0,1,?,?,?,?) ON CONFLICT(id,field) DO UPDATE SET v=excluded.v, hlc=excluded.hlc, pending=1, key=excluded.key, nonce=excluded.nonce, base=excluded.base, last_op=excluded.last_op", [id, f, this.enc(JSON.stringify(v)), hlc, key, nonce, baseSeq[f], opId]);
      }
      await this.db.run("INSERT INTO pending_ops(op_id, body) VALUES(?,?)", [opId, JSON.stringify({ opId, hlc, id, kind, enc: e2e, fields: wire, baseSeq, after })]);
      if (this.useFts) await this.ftsReindex(id);
    });
    this.notify(ids);
    return opId;
  }
  async queueDoc(id, u, { e2e = false } = {}) {
    const opId = `${this.dev}-${++this.n}`; const hlc = this.clock.tick();
    let wire = { v: u }; if (e2e) { const x = this.e2eKeys.enc(u); wire = { v: x.ct, key: x.key, nonce: x.nonce }; }
    await this.tx(async () => { await this.db.run("INSERT INTO pending_ops(op_id, body) VALUES(?,?)", [opId, JSON.stringify({ opId, hlc, id, kind: "doc", enc: e2e, fields: { u: wire }, baseSeq: {} })]); });
    return opId;
  }
  async ftsReindex(id) {
    const rows = await this.db.all("SELECT v FROM rows WHERE id=? AND key IS NULL", [id]);
    await this.db.run("DELETE FROM fts WHERE id=?", [id]);
    if (rows.length) await this.db.run("INSERT INTO fts(id, body) VALUES(?,?)", [id, rows.map((r) => String(JSON.parse(this.dec(r.v)))).join(" ")]);
  }
  async read(id) {
    const o = {};
    for (const r of await this.db.all("SELECT * FROM rows WHERE id=?", [id])) {
      let v = JSON.parse(this.dec(r.v));
      if (r.key && this.e2eKeys) v = JSON.parse(this.e2eKeys.dec(v, r.key, r.nonce));
      o[r.field] = v;
    }
    return o;
  }
  async rowCount() { return (await this.db.get("SELECT COUNT(DISTINCT id) AS c FROM rows")).c; }
  async visibleState() { // for property tests: {id: {field: v}}, ciphertext values as stored
    const o = {};
    for (const r of await this.db.all("SELECT id, field, v FROM rows ORDER BY id, field")) (o[r.id] ??= {})[r.field] = JSON.parse(this.dec(r.v));
    return o;
  }
  async pendingCount() { return (await this.db.get("SELECT COUNT(*) AS c FROM pending_ops")).c; }

  async push(t) {
    const rows = await this.db.all("SELECT op_id, body FROM pending_ops ORDER BY n LIMIT 200");
    if (!rows.length) return { applied: [], rejected: [], conflicts: [] };
    const res = await t.push(rows.map((r) => JSON.parse(r.body)));
    this.clock.observe(res.serverHlc);
    await this.tx(async () => {
      const done = new Set([...res.applied.map((a) => a.opId), ...res.rejected.map((r) => r.opId)]);
      for (const r of res.rejected) await this.db.run("INSERT OR REPLACE INTO rejected(op_id, body) VALUES(?,?)", [r.opId, JSON.stringify(r)]);
      for (const r of rows) if (done.has(r.op_id)) await this.db.run("DELETE FROM pending_ops WHERE op_id=?", [r.op_id]);
      await this.db.run("UPDATE rows SET pending=0");
      for (const r of await this.db.all("SELECT body FROM pending_ops")) { const b = JSON.parse(r.body); for (const f of Object.keys(b.fields)) await this.db.run("UPDATE rows SET pending=1 WHERE id=? AND field=?", [b.id, f]); }
    });
    return res;
  }

  async applyField(id, f, fv) {
    // one statement: server value replaces the optimistic one unless a pending local op is newer (it is re-pushed, the server decides)
    await this.db.run("INSERT INTO rows(id,field,v,hlc,seq,pending,key,nonce) VALUES(?,?,?,?,?,0,?,?) ON CONFLICT(id,field) DO UPDATE SET v=excluded.v, hlc=excluded.hlc, seq=excluded.seq, key=excluded.key, nonce=excluded.nonce WHERE rows.pending=0 OR rows.hlc<=excluded.hlc",
      [id, f, this.enc(JSON.stringify(fv.v)), fv.hlc, fv.seq ?? 0, fv.key || null, fv.nonce || null]);
  }
  async applyChanges(changes, seqOf = (c) => c.seq) {
    const touched = new Set();
    await this.tx(async () => {
      for (const c of changes) {
        const hid = await this.db.get("SELECT seq FROM hidden WHERE id=?", [c.id]);
        if (c.op === "hide") {
          await this.db.run("DELETE FROM rows WHERE id=?", [c.id]); await this.db.run("DELETE FROM docs WHERE id=?", [c.id]);
          if (this.useFts) await this.db.run("DELETE FROM fts WHERE id=?", [c.id]);
          await this.db.run("INSERT OR REPLACE INTO hidden(id, seq) VALUES(?,?)", [c.id, seqOf(c)]);
          touched.add(c.id); continue;
        }
        if (hid && seqOf(c) <= hid.seq) continue; // stale replay of a pre-hide change: never resurrects a purged row
        if (hid) await this.db.run("DELETE FROM hidden WHERE id=?", [c.id]);
        if (c.op === "ydoc") { const n = (await this.db.get("SELECT COALESCE(MAX(n),0)+1 AS n FROM docs WHERE id=?", [c.id])).n; await this.db.run("INSERT INTO docs(id,n,u) VALUES(?,?,?)", [c.id, n, JSON.stringify(c.fields)]); touched.add(c.id); continue; }
        for (const f of Object.keys(c.fields)) { const fv = { ...c.fields[f] }; if (fv.seq == null) fv.seq = seqOf(c); await this.applyField(c.id, f, fv); }
        if (this.useFts) await this.ftsReindex(c.id);
        touched.add(c.id);
      }
    });
    this.notify([...touched]);
  }
  async pull(t) {
    let guard = 0;
    for (;;) {
      const res = await t.pull({ cursor: this.cursor, epoch: this.epoch, limit: 2000, dev: this.dev });
      if (res.reset === "purge") { await this.purge(); this.epoch = res.epoch; return { purged: true }; }
      this.clock.observe(res.serverHlc);
      await this.applyChanges(res.changes);
      this.cursor = res.next; this.epoch = res.epoch;
      if (!res.more || ++guard > 100000) return res;
    }
  }
  async bootstrap(t) {
    const b = await t.snapshotBegin(); let after = "";
    for (;;) {
      const page = await t.snapshotPage({ after, limit: 5000, dev: this.dev });
      await this.tx(async () => {
        for (const r of page.rows) {
          if (r.doc) { let n = 0; for (const u of r.doc) await this.db.run("INSERT OR IGNORE INTO docs(id,n,u) VALUES(?,?,?)", [r.id, ++n, JSON.stringify(u)]); continue; }
          for (const f of Object.keys(r.fields)) await this.applyField(r.id, f, r.fields[f]);
          if (this.useFts) await this.ftsReindex(r.id);
        }
      });
      if (page.done) break; after = page.last;
    }
    this.cursor = b.asOf; this.epoch = b.epoch;
  }
  async purge() {
    await this.tx(async () => { for (const t of ["rows", "pending_ops", "hidden", "docs", "rejected"]) await this.db.run(`DELETE FROM ${t}`); if (this.useFts) await this.db.run("DELETE FROM fts"); });
    this.cursor = 0; this.notify(["*purge"]);
  }
}
