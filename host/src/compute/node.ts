// A computer that joins a Space for compute (`vyred --role compute --server <address> --join <code>`). It is a guest: it dials out, holds no event log, no replica and no Vault, and keeps only two small
// files in its data directory, its own key and what the Space handed it. First run: make an Ed25519 key, ask to join with the one-time code, print the name and the 8-character fingerprint a person
// compares when they approve, then wait. Once approved it holds one credential and reports in on a short cycle; a 401 means it was removed, so it forgets everything and stops.
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";

export type NodeFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface NodeDeps {
  server: string;
  join?: string | undefined;
  dataDir: string;
  name: string;
  fetch: NodeFetch;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  now(): number;
  log(line: string): void;
  facts(): { os: string; arch: string; docker: boolean; version: string };
  signal: AbortSignal;
  /** how often an unapproved computer asks, and an admitted one reports, in milliseconds */
  pollMs?: number;
  /** Opens a WebSocket (the live view). Default: the platform's WebSocket, which takes request headers on node. A test or another runtime passes its own. */
  socket?(url: string, headers?: Record<string, string>): NodeSocket;
  /** Makes what runs a job on this machine (the agent computers module's Docker host, behind its host seam). It gets the one door into an agent's home that a job's token opens. Without it the node takes no jobs. */
  makeHost?(link: HomeLink): { run(kind: string, input: unknown): Promise<unknown> };
}
export type NodeEnd = "stopped" | "declined" | "removed";

/** The part of a WebSocket the live view uses. */
export interface NodeSocket {
  send(data: string | Uint8Array): void;
  close(): void;
  readonly bufferedAmount: number;
  onOpen(f: () => void): void;
  onMessage(f: (data: string | Uint8Array) => void): void;
  onClose(f: () => void): void;
}

interface PlatformSocket {
  binaryType: string; readonly bufferedAmount: number;
  send(data: string | Uint8Array): void; close(): void;
  addEventListener(type: string, f: (ev: { data?: unknown }) => void): void;
}
function platformSocket(url: string, headers?: Record<string, string>): NodeSocket {
  const WS = (globalThis as unknown as { WebSocket: new (url: string, opts?: unknown) => PlatformSocket }).WebSocket;
  const ws = new WS(url, headers ? { headers } : undefined);
  ws.binaryType = "arraybuffer";
  return {
    send: (data) => ws.send(data), close: () => { try { ws.close(); } catch { /* already closed */ } },
    get bufferedAmount() { return ws.bufferedAmount; },
    onOpen: (f) => ws.addEventListener("open", () => f()),
    onMessage: (f) => ws.addEventListener("message", (ev) => f(typeof ev.data === "string" ? ev.data : new Uint8Array(ev.data as ArrayBuffer))),
    onClose: (f) => { let done = false; const once = (): void => { if (!done) { done = true; f(); } }; ws.addEventListener("close", once); ws.addEventListener("error", once); },
  };
}

const VIEW_ID = /^viw_[a-f0-9]{32}$/;
const COMPUTER_ID = /^cmt_[a-z0-9]{1,64}$/;
const MAX_LIVE_VIEWS = 8;
const VIEW_BACKLOG = 2 * 1024 * 1024;

/** A job in a poll answer. The token is the job's own: it reaches this computer's home, as this agent, for the length of the job. */
export interface NodeJob { jobId: string; computerId: string; agentId: string; kind: string; input: unknown; token: string }

/** The home mirror's way back to the Space: a call on Files as the agent, and bytes to an upload slot. Both ride the token of the job being run, so neither works outside one. */
export interface HomeLink {
  call(agentId: string, cap: string, input: unknown): Promise<unknown>;
  put(url: string, bytes: Uint8Array): Promise<void>;
}

/** What the node keeps about each job: it was started, and how it ended. A job it has an answer for is never run again; one it started and has no answer for is reported as interrupted, not repeated. */
interface JobRecord { state: "started" | "done" | "failed"; result?: unknown; error?: string; reported: boolean; at: number }
const JOB_KEEP_MS = 24 * 3_600_000;
const JOB_KEEP_MAX = 500;

const FP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const b64 = (b: ArrayBuffer | Uint8Array): string => Buffer.from(b as ArrayBuffer).toString("base64");

/** The same eight characters the Space shows its approver: a hash of the public key, as ABCD-EFGH. */
export async function fingerprintOf(publicKey: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Buffer.from(publicKey, "base64")));
  const chars = Array.from(digest.slice(0, 8), (x) => FP_ALPHABET[x % FP_ALPHABET.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

interface KeyFile { privateKey: string; publicKey: string }
interface StateFile { serverId: string; fingerprint: string; credential?: string }

function readJson<T>(file: string): T | null { try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return null; } }
function writePrivate(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 }); }

async function loadKey(dir: string): Promise<{ key: KeyFile; sign(text: string): Promise<string> }> {
  const file = path.join(dir, "compute-key.json");
  let key = readJson<KeyFile>(file);
  if (!key) {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    key = { privateKey: b64(await crypto.subtle.exportKey("pkcs8", pair.privateKey)), publicKey: b64(await crypto.subtle.exportKey("raw", pair.publicKey)) };
    writePrivate(file, key);
  }
  const priv = await crypto.subtle.importKey("pkcs8", Buffer.from(key.privateKey, "base64"), { name: "Ed25519" }, false, ["sign"]);
  return { key, sign: async (text) => b64(await crypto.subtle.sign({ name: "Ed25519" }, priv, new TextEncoder().encode(text))) };
}

export async function runComputeNode(d: NodeDeps): Promise<NodeEnd> {
  const server = d.server.replace(/\/+$/, "");
  const pollMs = d.pollMs ?? 3_000;
  const post = async (p: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: any }> => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await d.fetch(`${server}${p}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: d.signal });
    const j = (await r.json().catch(() => ({}))) as { data?: unknown };
    return { status: r.status, data: j.data ?? j };
  };
  const stateFile = path.join(d.dataDir, "compute-state.json");
  const { key, sign } = await loadKey(d.dataDir);
  let state = readJson<StateFile>(stateFile);
  const forget = (): void => { try { fs.rmSync(stateFile, { force: true }); fs.rmSync(path.join(d.dataDir, "compute-key.json"), { force: true }); } catch { /* nothing to forget */ } };

  if (!state) {
    if (!d.join) throw new Error("this computer has not joined a Space yet: give --join with the one-time code from Console, Network, Add a computer");
    const asked = await post("/v1/network/enroll", { code: d.join, publicKey: key.publicKey, name: d.name, facts: d.facts() });
    if (asked.status !== 200) throw new Error(`the Space did not accept the join code (${asked.status}): ${String(asked.data?.error?.message ?? "the code is wrong, used or expired")}`);
    state = { serverId: String(asked.data.serverId), fingerprint: String(asked.data.fingerprint) };
    writePrivate(stateFile, state);
    d.log(`Asked to join as "${d.name}". Fingerprint ${state.fingerprint}. Waiting for a person to approve it in Console, Network.`);
  } else if (!state.credential) {
    d.log(`Waiting for approval. Fingerprint ${state.fingerprint}.`);
  }

  // waiting: ask, signed, until a person decides
  while (!state.credential) {
    if (d.signal.aborted) return "stopped";
    const at = d.now();
    const r = await post("/v1/network/enroll_status", { serverId: state.serverId, at, signature: await sign(`vyre-enroll:${state.serverId}:${at}`) }).catch(() => null);
    if (r && r.status === 200) {
      if (r.data.state === "declined") { d.log("The Space turned this computer away."); forget(); return "declined"; }
      if (r.data.state === "revoked") { d.log("This computer was removed from the Space."); forget(); return "removed"; }
      if (r.data.state === "approved" && typeof r.data.credential === "string") {
        state = { ...state, credential: r.data.credential };
        writePrivate(stateFile, state);
        d.log("Approved. This computer is part of the Space now.");
        break;
      }
    } else if (r && r.status >= 400 && r.status < 500) { d.log("The Space does not know this computer any more."); forget(); return "removed"; }
    await d.sleep(pollMs, d.signal).catch(() => undefined);
  }

  // admitted: report in on a short cycle, take the jobs the Space has for this computer, answer them; a plain 401 means it was removed
  const credential = state.credential as string;
  const jobsFile = path.join(d.dataDir, "compute-jobs.json");
  const records = new Map<string, JobRecord>(Object.entries(readJson<Record<string, JobRecord>>(jobsFile) ?? {}));
  const saveRecords = (): void => {
    const at = d.now();
    for (const [id, r] of records) if (r.state !== "started" && r.reported && at - r.at > JOB_KEEP_MS) records.delete(id);
    while (records.size > JOB_KEEP_MAX) records.delete(records.keys().next().value as string);
    const tmp = `${jobsFile}.tmp`;
    fs.mkdirSync(d.dataDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(records)), { mode: 0o600 });
    fs.renameSync(tmp, jobsFile);
  };
  const als = new AsyncLocalStorage<{ token: string; computerId: string }>();
  const door = (): { token: string; computerId: string } => { const at = als.getStore(); if (!at) throw new Error("the home is reachable only from inside a job"); return at; };
  const link: HomeLink = {
    async call(_agentId, cap, input) {
      const at = door();
      const r = await post("/compute/home", { token: at.token, computerId: at.computerId, cap, input }, { authorization: `Bearer ${credential}` });
      if (r.status !== 200) throw new Error(String(r.data?.error?.message ?? `the Space refused ${cap} (${r.status})`));
      return r.data.output;
    },
    async put(url, bytes) {
      const at = door();
      const r = await post("/compute/home", { token: at.token, computerId: at.computerId, cap: "put_upload", input: { url, base64: Buffer.from(bytes).toString("base64") } }, { authorization: `Bearer ${credential}` });
      if (r.status !== 200) throw new Error(String(r.data?.error?.message ?? `the Space refused the upload (${r.status})`));
    },
  };
  const host = d.makeHost?.(link);
  const wipeMirror = (agentId: string): void => {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(agentId)) return;
    try { fs.rmSync(path.join(d.dataDir, "computers", agentId), { recursive: true, force: true }); } catch { /* a copy that could not be wiped is wiped at the next sleep */ }
  };
  const forgetAll = (): void => { forget(); try { fs.rmSync(jobsFile, { force: true }); fs.rmSync(path.join(d.dataDir, "computers"), { recursive: true, force: true }); } catch { /* nothing left to wipe */ } };
  const inflight = new Set<string>();
  const lanes = new Map<string, Promise<void>>();   // one computer's jobs run one after another
  let removed = false;

  /** Tell the Space how a job ended. A reply that is lost leaves the record unreported; it is sent again next cycle, and the Space keeps the first answer only. */
  async function report(jobId: string): Promise<void> {
    const r = records.get(jobId);
    if (!r || r.state === "started") return;
    const sent = await post("/compute/result", { jobId, ok: r.state === "done", ...(r.state === "done" ? { result: r.result ?? null } : { error: r.error ?? "The computer could not do that." }) }, { authorization: `Bearer ${credential}` }).catch(() => null);
    if (sent && sent.status === 401) { removed = true; return; }
    if (sent && (sent.status === 200 || sent.status === 404)) { r.reported = true; saveRecords(); }
  }
  async function run(job: NodeJob): Promise<void> {
    try {
      if (!host) throw new Error("This computer does not take jobs yet.");
      const result = await als.run({ token: job.token, computerId: job.computerId }, () => host.run(job.kind, job.input));
      // The copy of an agent's home on this machine is a working mirror: Files holds the truth. It is wiped when the computer sleeps, but only after the sync that closed the session finished (a pass
      // that left anything undone keeps it, and the next wake syncs it), and always when the computer is removed.
      if ((job.kind === "stop" && (result as { homeSynced?: unknown } | null)?.homeSynced === true) || job.kind === "remove") wipeMirror(job.agentId);
      records.set(job.jobId, { state: "done", result, reported: false, at: d.now() });
    } catch (e) {
      records.set(job.jobId, { state: "failed", error: (e instanceof Error ? e.message : "The computer could not do that.").slice(0, 400), reported: false, at: d.now() });
    }
    saveRecords();
    inflight.delete(job.jobId);
    await report(job.jobId);
  }
  function take(job: NodeJob): void {
    if (inflight.has(job.jobId)) return;   // still running: this poll keeps its lease
    const known = records.get(job.jobId);
    if (known && known.state !== "started") { void report(job.jobId); return; }   // answered already (the reply was lost): say it again, never run it again
    if (known && known.state === "started") {   // started and never answered: this process died in the middle; whatever it did is not done twice
      records.set(job.jobId, { state: "failed", error: "This computer stopped in the middle of that, so it was not run again.", reported: false, at: d.now() });
      saveRecords();
      void report(job.jobId);
      return;
    }
    records.set(job.jobId, { state: "started", reported: false, at: d.now() });
    saveRecords();
    inflight.add(job.jobId);
    const lane = (lanes.get(job.computerId) ?? Promise.resolve()).then(() => run(job));
    lanes.set(job.computerId, lane);
    void lane.finally(() => { if (lanes.get(job.computerId) === lane) lanes.delete(job.computerId); });
  }

  // ---- the live view: one outbound socket to the Space, over which the Space asks for a computer's view and sends the person's input. The frames come from agentd's own stream server on this machine
  // (its address stays here); they go up the one socket, tagged with the view the Space named. This machine hosts only the computers it made, so a view of any other is refused by its own host.
  let ended = false;   // the node's loop has returned: the view socket goes with it
  const openSocket = d.socket ?? platformSocket;
  async function liveView(): Promise<void> {
    const url = `${server.replace(/^http/, "ws")}/compute/stream`;
    const up = openSocket(url, { authorization: `Bearer ${credential}` });
    const local = new Map<string, NodeSocket>();
    const send = (data: string | Uint8Array): void => { try { up.send(data); } catch { /* the socket is going away */ } };
    const say = (m: Record<string, unknown>): void => send(JSON.stringify(m));
    await new Promise<void>((resolve) => {
      let hb: ReturnType<typeof setInterval> | undefined;
      let watch: ReturnType<typeof setInterval> | undefined;
      const end = (): void => { if (hb) clearInterval(hb); if (watch) clearInterval(watch); d.signal.removeEventListener("abort", end); for (const s of local.values()) s.close(); local.clear(); up.close(); resolve(); };
      d.signal.addEventListener("abort", end, { once: true });
      watch = setInterval(() => { if (removed || ended) end(); }, 500); watch.unref?.();
      up.onOpen(() => { hb = setInterval(() => say({ t: "hb" }), 15_000); hb.unref?.(); });
      up.onClose(end);
      up.onMessage((data) => {
        if (typeof data !== "string") return;
        let m: { t?: unknown; view?: unknown; computerId?: unknown; data?: unknown };
        try { m = JSON.parse(data) as typeof m; } catch { return; }
        const view = typeof m.view === "string" && VIEW_ID.test(m.view) ? m.view : "";
        if (m.t === "close" && view) { local.get(view)?.close(); local.delete(view); return; }
        if (m.t === "input" && view && typeof m.data === "string" && m.data.length <= 4096) { local.get(view)?.send(m.data); return; }
        if (m.t !== "open" || !view || typeof m.computerId !== "string" || !COMPUTER_ID.test(m.computerId) || local.has(view)) return;
        if (local.size >= MAX_LIVE_VIEWS || !host) { say({ t: "failed", view, reason: "This computer cannot show another view right now." }); return; }
        const computerId = m.computerId;
        void (async () => {
          try {
            const target = (await host.run("stream", { computerId, ticket: view })) as { ws?: unknown } | null;
            const wsUrl = typeof target?.ws === "string" ? target.ws : "";
            if (!/^wss?:\/\//.test(wsUrl)) throw new Error("This computer has no live view to relay.");
            const idBytes = Buffer.from(view, "latin1");
            const prefix = Buffer.concat([Buffer.from([idBytes.length]), idBytes]);
            const s = openSocket(wsUrl);
            local.set(view, s);
            s.onOpen(() => say({ t: "opened", view }));
            s.onMessage((frame) => {
              if (typeof frame === "string") { say({ t: "msg", view, data: frame }); return; }
              if (up.bufferedAmount > VIEW_BACKLOG) return;   // the Space is behind: a viewer sees fewer frames, never old ones
              send(Buffer.concat([prefix, frame]));
            });
            s.onClose(() => { if (local.get(view) === s) { local.delete(view); say({ t: "ended", view }); } });
          } catch (e) { say({ t: "failed", view, reason: (e instanceof Error ? e.message : "The computer could not open its view.").slice(0, 200) }); }
        })();
      });
    });
  }
  void (async () => {
    // Held open for as long as this computer is admitted; a dropped socket is dialled again after a pause.
    while (host && !d.signal.aborted && !removed && !ended) {
      await liveView().catch(() => undefined);
      await d.sleep(Math.min(Math.max(pollMs, 500), 5_000), d.signal).catch(() => undefined);
    }
  })();

  try {
    for (;;) {
      if (d.signal.aborted || removed) { if (removed) { d.log("This computer was removed from the Space. Its credential no longer works."); forgetAll(); return "removed"; } return "stopped"; }
      for (const [id, rec] of records) if (rec.state !== "started" && !rec.reported && !inflight.has(id)) await report(id);
      const f = d.facts();
      const r = await post("/compute/poll", { docker: f.docker, version: f.version, running: [...inflight] }, { authorization: `Bearer ${credential}` }).catch(() => null);
      if (r && r.status === 401) { d.log("This computer was removed from the Space. Its credential no longer works."); forgetAll(); return "removed"; }
      const jobs = r && r.status === 200 && Array.isArray(r.data.jobs) ? (r.data.jobs as NodeJob[]) : [];
      for (const job of jobs) if (job && typeof job.jobId === "string" && typeof job.computerId === "string" && typeof job.kind === "string" && typeof job.token === "string") take(job);
      const busy = jobs.length > 0 || inflight.size > 0;
      await d.sleep(busy ? Math.min(pollMs, 400) : pollMs, d.signal).catch(() => undefined);
    }
  } finally { ended = true; }
}
