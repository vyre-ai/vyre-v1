// The live view, take-over and recordings of an agent computer that lives on a computer that joined the Space, on a booted daemon with a booted compute node. The node only dials out: it holds one WebSocket
// to the Space and the Space bridges a viewer's ticketed connection onto it. The node here runs in this process (runComputeNode) with a stand-in for Docker: the stand-in is the real agentd stream server
// (images/agent-computer/agentd/stream.ts, the code that serves frames and applies input in the container) over a fake frame source and a fake input injector, and the real home mirror over a folder.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fileExportsImporter } from "../src/loader.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import { runComputeNode } from "../src/compute/node.ts";
import type { HomeLink, NodeDeps } from "../src/compute/node.ts";
import { startStreamServer } from "../../images/agent-computer/agentd/stream.ts";
import type { StreamServer } from "../../images/agent-computer/agentd/stream.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until<T>(what: string, f: () => Promise<T | undefined | false> | T | undefined | false, ms = 10_000): Promise<T> {
  const t0 = Date.now();
  for (;;) { const v = await f(); if (v) return v as T; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await wait(40); }
}

type Reply = { status: number; json: { data?: any; error?: { code: string; message: string } } };   // eslint-disable-line @typescript-eslint/no-explicit-any
const post = async (d: Daemon, p: string, body: unknown, token?: string): Promise<Reply> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as Reply["json"] };
};

async function boot(): Promise<{ d: Daemon; owner: string; dir: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-stream-space-"));
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_stream", "--space-name", "Stream Co", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({ os: "linux", hostname: "stream-space", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
    fetch: caddyFetch, computeStreamRecheckMs: 300,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
  const device = { deviceName: "Mac", deviceClass: "desktop" };
  assert.equal((await post(d, "/v1/identity/claim_owner", { code, spaceId: "spc_stream", username: "olivia", displayName: "Olivia", password: PASSWORD, ...device, keys: KEYS })).status, 200);
  const signedIn = await post(d, "/v1/identity/sign_in", { username: "olivia", password: PASSWORD, ...device });
  assert.equal(signedIn.status, 200);
  return { d, owner: signedIn.json.data.session.token as string, dir };
}

/** A directory the node's mirror lives in, as the module's HomeFs. */
function dirFs(root: string) {
  return {
    async snapshot() {
      const files = new Map<string, { bytes: Buffer; mtimeMs: number }>(); const dirs = new Set<string>();
      const walk = (rel: string): void => {
        for (const e of fs.existsSync(path.join(root, rel)) ? fs.readdirSync(path.join(root, rel), { withFileTypes: true }) : []) {
          const r = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) { dirs.add(r); walk(r); } else files.set(r, { bytes: fs.readFileSync(path.join(root, r)), mtimeMs: fs.statSync(path.join(root, r)).mtimeMs });
        }
      };
      walk("");
      return { files, dirs, refused: [] as string[], complete: true };
    },
    async put(list: Array<{ rel: string; bytes: Uint8Array; readOnly: boolean }>) { for (const f of list) { fs.mkdirSync(path.dirname(path.join(root, f.rel)), { recursive: true }); fs.writeFileSync(path.join(root, f.rel), f.bytes); } },
    async remove(files: string[], dirs: string[]) { for (const f of files) fs.rmSync(path.join(root, f), { force: true }); for (const g of dirs) fs.rmSync(path.join(root, g), { recursive: true, force: true }); },
  };
}

const freePort = (): Promise<number> => new Promise((resolve) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); });

/** A frame the viewer can tell from any other: JPEG start and end markers around a counter. */
const jpegFrame = (n: number): Buffer => Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from(`FRAME-${n}`), Buffer.from([0xff, 0xd9])]);

interface StandIn {
  /** what the stand-in computer was asked, in order */
  executed: string[];
  /** view ids the Space gave the node (the `ticket` of a stream run) */
  views: string[];
  inputs: Record<string, unknown>[];
  taken: { on: boolean };
  video: Buffer;
  stop(): void;
}

/** The node's host: a stand-in for the Docker host, honouring the same calls nodeRun makes. agentd's stream server is the real one. */
function standIn(nodeDir: string): { make(link: HomeLink): { run(kind: string, input: unknown): Promise<unknown> }; state: StandIn } {
  const state: StandIn = { executed: [], views: [], inputs: [], taken: { on: false }, video: Buffer.alloc(600_000, 7), stop: () => undefined };
  let agd: StreamServer | undefined;
  let counter = 0;
  const agentOf = new Map<string, string>();
  const syncs = new Map<string, { pass(): Promise<{ failed: number }> }>();
  const mirrorOf = (agentId: string): string => path.join(nodeDir, "computers", agentId, "Vyre");
  const timers = new Set<ReturnType<typeof setInterval>>();
  state.stop = () => { agd?.close(); for (const t of timers) clearInterval(t); };
  return {
    state,
    make(link) {
      async function syncFor(computerId: string) {
        const agentId = agentOf.get(computerId)!;
        let s = syncs.get(computerId);
        if (!s) {
          const { createHomeSync } = (await fileExportsImporter(ROOT)("computers")) as unknown as { createHomeSync: (o: unknown, d: unknown) => { pass(): Promise<{ failed: number }> } };
          s = createHomeSync({ agentId, computerId, fs: dirFs(mirrorOf(agentId)), manifest: path.join(nodeDir, "computers", agentId, "home-manifest.json") }, { callAs: link.call, putBytes: link.put, now: Date.now, log: () => undefined });
          syncs.set(computerId, s);
        }
        return s;
      }
      return {
        async run(kind, input) {
          const a = (input ?? {}) as Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
          state.executed.push(kind);
          switch (kind) {
            case "create": agentOf.set(String(a["computerId"]), String(a["agentId"])); return { diskBytes: 1024 };
            case "start": { agentOf.set(String(a["computerId"]), String(a["agentId"] ?? agentOf.get(String(a["computerId"])))); await (await syncFor(String(a["computerId"]))).pass(); return {}; }
            case "stop": { const r = await (await syncFor(String(a["computerId"]))).pass(); return { sessions: [], diskBytes: 2048, homeSynced: r.failed === 0 }; }
            case "probe": return { running: true, busy: false, tabs: 1 };
            case "takeover": state.taken.on = true; return {};
            case "giveBack": state.taken.on = false; return {};
            case "stream": {
              // the real agentd stream server, over frames that tick and an injector that records what reached the X server
              if (!agd) {
                const port = await freePort();
                const hub = { watch(cb: (j: Buffer) => void) { const t = setInterval(() => cb(jpegFrame(counter++)), 25); timers.add(t); return () => { clearInterval(t); timers.delete(t); }; }, viewers: () => 0, lastFrameAt: () => null, latest: () => null };
                agd = startStreamServer({ port, hub, input: { call: async (req) => { state.inputs.push(req); return { x: 1, y: 2 }; }, stop: () => undefined }, takenOver: () => state.taken.on, address: () => "127.0.0.1", onInput: () => undefined });
              }
              state.views.push(String(a["ticket"]));
              const t = agd.mint();
              return { transport: "mjpeg", url: agd.url(t, "mjpeg"), ws: agd.url(t, "ws") };
            }
            case "record": {
              if (a["action"] === "start") return {};
              // agentd writes the video into the home it shares with the container
              const dir = path.join(mirrorOf(agentOf.get(String(a["computerId"]))!), "work", "recordings", String(a["recordingId"]));
              fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(path.join(dir, "video.mp4"), state.video);
              return { events: '{"type":"click","by":"person"}\n', har: JSON.stringify({ log: { version: "1.2", entries: [] } }), durationMs: 61_000 };
            }
            case "saveRecording": {
              const dir = path.join(mirrorOf(agentOf.get(String(a["computerId"]))!), String(a["folderPath"]));
              fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(path.join(dir, "events.jsonl"), String(a["events"]));
              fs.writeFileSync(path.join(dir, "network.har"), String(a["har"]));
              await wait(1_100);   // the pass skips a file written in the last second
              const r = await (await syncFor(String(a["computerId"]))).pass();
              if (r.failed > 0) throw new Error("the recording did not reach Files");
              return {};
            }
            case "removeRecording": fs.rmSync(path.join(mirrorOf(agentOf.get(String(a["computerId"]))!), String(a["folderPath"])), { recursive: true, force: true }); return { removed: true };
            default: return {};
          }
        },
      };
    },
  };
}

function nodeFor(d: Daemon, dataDir: string, host: (link: HomeLink) => { run(kind: string, input: unknown): Promise<unknown> }): { run(join?: string): Promise<string>; abort: AbortController } {
  const abort = new AbortController();
  const deps = (join?: string): NodeDeps => ({
    server: d.url, join, dataDir, name: "Olivia's Mac", signal: abort.signal, now: Date.now, pollMs: 100,
    fetch: (url, init) => fetch(url, init) as never,
    sleep: (ms, signal) => new Promise<void>((resolve, reject) => { const t = setTimeout(resolve, ms); signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("stopped")); }, { once: true }); }),
    log: () => undefined, facts: () => ({ os: "darwin", arch: "arm64", docker: true, version: "t" }),
    makeHost: host,
  });
  return { abort, run: (join) => runComputeNode(deps(join)) };
}

async function enroll(d: Daemon, owner: string, dataDir: string, host: Parameters<typeof nodeFor>[2]): Promise<{ nodeId: string; running: Promise<string>; node: ReturnType<typeof nodeFor> }> {
  const code = (await post(d, "/v1/network/server_join_code", { idempotencyKey: `jc-${Math.random()}` }, owner)).json.data.code as string;
  const node = nodeFor(d, dataDir, host);
  const running = node.run(code);
  const known = new Set<string>();
  let waiting: { serverId: string } | undefined;
  for (let i = 0; i < 80 && !waiting; i++) { waiting = (await post(d, "/v1/network/servers", {}, owner)).json.data.servers.find((r: { enrollment?: string; serverId: string }) => r.enrollment === "pending" && !known.has(r.serverId)); if (!waiting) await wait(100); }
  assert.ok(waiting, "the computer shows as waiting");
  assert.equal((await post(d, "/v1/network/server_approve", { serverId: waiting!.serverId }, owner)).status, 200);
  return { nodeId: waiting!.serverId, running, node };
}

async function agent(d: Daemon, owner: string, name: string): Promise<{ agentId: string; folderId: string }> {
  assert.equal((await post(d, "/v1/agents/create", { name, role: `Use ${name}.`, idempotencyKey: `ag-${name}` }, owner)).status, 200);
  const r = d.db!.all("SELECT id, folderId FROM agents_agent WHERE name = ?", name)[0] as { id: string; folderId: string };
  return { agentId: r.id, folderId: r.folderId };
}

/** Read an MJPEG response until `frames` frames arrived or it ends; returns what it saw and whether it ended on its own. */
async function readMjpeg(res: Response, frames: number, ms = 6_000): Promise<{ text: string; count: number; ended: boolean }> {
  const reader = res.body!.getReader();
  let text = ""; let count = 0; let ended = false;
  const stop = Date.now() + ms;
  while (Date.now() < stop && count < frames) {
    const got = await Promise.race([reader.read(), wait(stop - Date.now()).then(() => null)]);
    if (got === null) break;
    if (got.done) { ended = true; break; }
    text += Buffer.from(got.value).toString("latin1");
    count = text.split("--vyreframe").length - 1;
  }
  if (!ended) await reader.cancel().catch(() => undefined);
  return { text, count, ended };
}

/** A viewer's WebSocket: the frames it was sent, the text it was sent, and a way to send and wait. */
async function viewerSocket(url: string): Promise<{ ws: WebSocket; frames: Buffer[]; texts: Array<Record<string, any>>; closed: Promise<number>; send(m: Record<string, unknown>): void }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  const frames: Buffer[] = []; const texts: Array<Record<string, any>> = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  const closed = new Promise<number>((r) => { ws.addEventListener("close", (e) => r((e as CloseEvent).code)); ws.addEventListener("error", () => r(-1)); });
  ws.addEventListener("message", (ev) => { if (typeof ev.data === "string") texts.push(JSON.parse(ev.data)); else frames.push(Buffer.from(ev.data as ArrayBuffer)); });
  await new Promise<void>((resolve, reject) => { ws.addEventListener("open", () => resolve()); ws.addEventListener("error", () => reject(new Error(`the view socket did not open: ${url}`))); });
  return { ws, frames, texts, closed, send: (m) => ws.send(JSON.stringify(m)) };
}

/** Ask for a ticket until the node's socket is up (a ticket is spent by an attempt, so each try gets a new one). */
async function openedView<T>(d: Daemon, owner: string, computerId: string, via: (url: string, ticket: string) => Promise<T | null>): Promise<T> {
  return until("the node's live-view socket", async () => {
    const s = await post(d, "/v1/computers/stream", { computerId }, owner);
    assert.equal(s.status, 200, JSON.stringify(s.json));
    return (await via(s.json.data.url as string, s.json.data.ticket as string)) ?? undefined;
  }, 15_000);
}

test("a computer on a node can be watched, taken over and recorded from the Space, and only by people allowed to", async () => {
  const { d, owner, dir } = await boot();
  const nodeDir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-stream-node-"));
  const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-stream-node2-"));
  const mine = standIn(nodeDir), other = standIn(otherDir);
  const { nodeId, running, node } = await enroll(d, owner, nodeDir, mine.make);
  const second = await enroll(d, owner, otherDir, other.make);
  const open: Array<{ close(): void }> = [];
  try {
    const a = await agent(d, owner, "Scout");
    const made = await post(d, "/v1/computers/provision", { agentId: a.agentId, nodeId, idempotencyKey: "pv-s" }, owner);
    assert.equal(made.status, 200, JSON.stringify(made.json));
    const id = made.json.data.computer.computerId as string;
    assert.equal((await post(d, "/v1/computers/wake", { computerId: id }, owner)).json.data.computer.state, "working");
    const spaceUrl = d.url.replace(/^http/, "ws");

    // ---- the view: frames reach a viewer through the bridge, and the address is the Space's own
    const first = await post(d, "/v1/computers/stream", { computerId: id }, owner);
    assert.equal(first.json.data.transport, "mjpeg");
    assert.equal(first.json.data.url, `/computers/${id}/stream`, "the viewer connects to the Space, never to the node");
    const seen = await openedView(d, owner, id, async (url, ticket) => {
      const res = await fetch(`${d.url}${url}?ticket=${ticket}`);
      if (res.status !== 200) { await res.body?.cancel(); return null; }
      assert.match(res.headers.get("content-type") ?? "", /^multipart\/x-mixed-replace/);
      return readMjpeg(res, 4);
    });
    assert.ok(seen.count >= 4, `frames arrived through the bridge (${seen.count})`);
    assert.ok(/FRAME-\d+/.test(seen.text) && seen.text.includes("image/jpeg"), "they are the computer's own JPEG frames");
    assert.equal(mine.state.views.length >= 1, true, "the node was asked for the view");
    assert.equal(other.state.executed.filter((k) => k === "stream").length, 0, "another node was never asked");

    // ---- refused: no ticket, a made-up ticket, a spent ticket, a ticket for another computer
    const t1 = (await post(d, "/v1/computers/stream", { computerId: id }, owner)).json.data.ticket as string;
    const ok1 = await fetch(`${d.url}/computers/${id}/stream?ticket=${t1}`);
    assert.equal(ok1.status, 200); await readMjpeg(ok1, 1);
    for (const [what, url] of [["a spent ticket", `/computers/${id}/stream?ticket=${t1}`], ["no ticket", `/computers/${id}/stream`], ["a made-up ticket", `/computers/${id}/stream?ticket=cpt_${"0".repeat(48)}`]] as const) {
      const r = await fetch(`${d.url}${url}`); await r.body?.cancel();
      assert.equal(r.status, 403, what);
    }
    const t2 = (await post(d, "/v1/computers/stream", { computerId: id }, owner)).json.data.ticket as string;
    const wrong = await fetch(`${d.url}/computers/cmt_someoneelses/stream?ticket=${t2}`); await wrong.body?.cancel();
    assert.equal(wrong.status, 403, "a ticket is for its own computer");
    const refusedWs = await new Promise<string>((resolve) => { const w = new WebSocket(`${spaceUrl}/computers/${id}/ws?ticket=${t2}`); w.addEventListener("open", () => resolve("opened")); w.addEventListener("error", () => resolve("refused")); });
    assert.equal(refusedWs, "refused", "and spent by the refused attempt");
    // a person who is not allowed to watch is not given a ticket at all
    const invite = await post(d, "/v1/members/invites/create", { role: "rol_member", idempotencyKey: "st-invite" }, owner);
    const code = decodeURIComponent(new URL(invite.json.data.link).pathname.split("/").pop() ?? "");
    const joined = await post(d, "/v1/members/accept", { code, username: "pia", password: PASSWORD, deviceName: "Mac", deviceClass: "desktop", keys: KEYS });
    assert.equal(joined.status, 200, JSON.stringify(joined.json));
    const pia = joined.json.data.token as string;
    // a member may watch (the default role holds computers.watch) but holds no controls: taking over, and so any input or recording, is refused
    const piaTake = await post(d, "/v1/computers/take_over", { computerId: id }, pia);
    assert.ok(piaTake.status === 403 || piaTake.status === 404, `take over as a person without use: ${piaTake.status} ${JSON.stringify(piaTake.json)}`);
    const piaTicket = (await post(d, "/v1/computers/stream", { computerId: id }, pia)).json.data?.ticket as string;
    const piaView = await viewerSocket(`${spaceUrl}/computers/${id}/ws?ticket=${piaTicket}`);
    open.push({ close: () => piaView.ws.close() });
    piaView.send({ t: "move", x: 3, y: 3, seq: 1 });
    await until("a refusal for the member", () => piaView.texts.find((m) => m["t"] === "refused"));
    assert.deepEqual(mine.state.inputs, [], "a watcher's input never reaches the computer");
    assert.equal((await post(d, "/v1/computers/stream", { computerId: id })).status, 401, "and not without a session");

    // ---- another node cannot reach this computer's view, whatever it sends
    const viewId = mine.state.views[mine.state.views.length - 1]!;
    const live = await openedView(d, owner, id, async (url, ticket) => { const r = await fetch(`${d.url}${url}?ticket=${ticket}`); if (r.status !== 200) { await r.body?.cancel(); return null; } return r; });
    const credential2 = (JSON.parse(fs.readFileSync(path.join(otherDir, "compute-state.json"), "utf8")) as { credential: string }).credential;
    const liveView = mine.state.views[mine.state.views.length - 1]!;
    assert.notEqual(liveView, viewId);
    const evil = new (globalThis as unknown as { WebSocket: new (u: string, o: unknown) => WebSocket })["WebSocket"](`${spaceUrl}/compute/stream`, { headers: { authorization: `Bearer ${credential2}` } });
    await new Promise<void>((resolve, reject) => { evil.addEventListener("open", () => resolve()); evil.addEventListener("error", () => reject(new Error("the second node's socket did not open"))); });
    const idBytes = Buffer.from(liveView, "latin1");
    evil.send(Buffer.concat([Buffer.from([idBytes.length]), idBytes, Buffer.from("EVIL-FRAME")]));
    evil.send(JSON.stringify({ t: "ended", view: liveView }));
    evil.send(JSON.stringify({ t: "msg", view: liveView, data: "EVIL-TEXT" }));
    const reading = await readMjpeg(live, 12);
    assert.ok(reading.count >= 12, "the real view kept going: another node's `ended` closed nothing");
    assert.ok(!reading.text.includes("EVIL"), "and another node's frames never reached the viewer");
    evil.close();

    // ---- take over: nothing reaches the computer before it, and a watch ticket never gives input
    const watch = await openedView(d, owner, id, async (url, ticket) => { try { return await viewerSocket(`${spaceUrl}${url.replace(/stream$/, "ws")}?ticket=${ticket}`); } catch { return null; } });
    open.push({ close: () => watch.ws.close() });
    await until("frames on the socket", () => watch.frames.length >= 3);
    assert.ok(watch.frames.some((f) => f.includes("FRAME-")), "frames reach a WebSocket viewer");
    watch.send({ t: "move", x: 10, y: 10, seq: 1 });
    await until("a refusal", () => watch.texts.find((m) => m["t"] === "refused" && m["seq"] === 1));
    assert.deepEqual(mine.state.inputs, [], "nothing got through before take-over");
    const taken = await post(d, "/v1/computers/take_over", { computerId: id }, owner);
    assert.equal(taken.status, 200, JSON.stringify(taken.json));
    assert.equal(taken.json.data.computer.state, "takeover");
    watch.send({ t: "move", x: 11, y: 11, seq: 2 });
    await until("a refusal for the watch ticket", () => watch.texts.find((m) => m["t"] === "refused" && m["seq"] === 2));
    assert.deepEqual(mine.state.inputs, [], "a watch ticket gives no input even during take-over");
    const control = await openedView(d, owner, id, async (_url, _ticket) => {
      const tk = (await post(d, "/v1/computers/take_over", { computerId: id }, owner)).json.data.ticket as string;
      try { return await viewerSocket(`${spaceUrl}/computers/${id}/ws?ticket=${tk}`); } catch { return null; }
    });
    open.push({ close: () => control.ws.close() });
    control.send({ t: "move", x: 42, y: 24, seq: 7 });
    const ack = await until("the computer's acknowledgement", () => control.texts.find((m) => m["t"] === "ack" && m["seq"] === 7));
    assert.deepEqual([ack["x"], ack["y"]], [1, 2], "the answer is the computer's own");
    assert.deepEqual(mine.state.inputs, [{ op: "move", x: 42, y: 24 }], "take-over input reached the computer");
    control.send({ t: "ping", seq: 8 });
    await until("a pong", () => control.texts.find((m) => m["t"] === "pong"));

    // ---- a recording on the node reaches Files and plays back from the Space
    const started = await post(d, "/v1/computers/record_start", { computerId: id }, owner);
    assert.equal(started.status, 200, JSON.stringify(started.json));
    const recordingId = started.json.data.recordingId as string;
    const stopped = await post(d, "/v1/computers/record_stop", { computerId: id }, owner);
    assert.equal(stopped.status, 200, JSON.stringify(stopped.json));
    assert.equal(stopped.json.data.recording.state, "saved");
    assert.equal(stopped.json.data.recording.durationMs, 61_000);
    const got = await post(d, "/v1/computers/recording/get", { recordingId }, owner);
    assert.equal(got.status, 200, JSON.stringify(got.json));
    const folder = (await post(d, "/v1/files/folder/get", { folderId: a.folderId }, owner)).json.data.folder.path as string;
    const fileOf = async (name: string) => { const r = await post(d, "/v1/files/resolve", { path: `${folder}/work/recordings/${recordingId}/${name}` }, owner); return r.status === 200 ? (r.json.data.fileId as string) : undefined; };
    const videoId = await fileOf("video.mp4");
    assert.ok(videoId, "the video reached Files through the upload slot");
    const video = await post(d, "/v1/files/read", { fileId: videoId, as: "base64" }, owner);
    assert.equal(video.status, 200, JSON.stringify(video.json).slice(0, 300));
    assert.ok(Buffer.from(video.json.data.base64 as string, "base64").equals(mine.state.video), "and plays back from the Space byte for byte");
    assert.equal((await post(d, "/v1/files/read", { fileId: (await fileOf("events.jsonl"))!, as: "text" }, owner)).json.data.text, '{"type":"click","by":"person"}\n', "the masked events are beside it");
    assert.ok(await fileOf("network.har"));
    const processed = await post(d, "/v1/computers/recording/process", { recordingId, intents: ["make_skill"], idempotencyKey: "rp-1" }, owner);
    assert.equal(processed.status, 200, JSON.stringify(processed.json));
    // give the controls back; input stops at once
    assert.equal((await post(d, "/v1/computers/give_back", { computerId: id }, owner)).json.data.computer.state, "working");
    await wait(700);
    const before = mine.state.inputs.length;
    control.send({ t: "move", x: 1, y: 1, seq: 9 });
    await until("a refusal after give-back", () => control.texts.find((m) => m["t"] === "refused" && m["seq"] === 9));
    assert.equal(mine.state.inputs.length, before, "nothing gets through after the controls are given back");
    // deleting removes it on the node and in Files
    assert.equal((await post(d, "/v1/computers/recording/delete", { recordingId }, owner)).json.data.deleted, true);
    assert.ok(mine.state.executed.includes("removeRecording"), "the node was told to remove its copy");
    assert.equal(fs.existsSync(path.join(nodeDir, "computers", a.agentId, "Vyre", "work", "recordings", recordingId)), false, "and its copy is gone");
    assert.equal(await fileOf("video.mp4"), undefined, "the Files copy is gone too");
    assert.equal((await post(d, "/v1/computers/recordings/list", { computerId: id }, owner)).json.data.recordings.length, 0);

    // ---- a removed node loses its stream at once
    const stream2 = await openedView(d, owner, id, async (url, ticket) => { const r = await fetch(`${d.url}${url}?ticket=${ticket}`); if (r.status !== 200) { await r.body?.cancel(); return null; } return r; });
    const sock2 = await openedView(d, owner, id, async (url, ticket) => { try { return await viewerSocket(`${spaceUrl}${url.replace(/stream$/, "ws")}?ticket=${ticket}`); } catch { return null; } });
    const ended = readMjpeg(stream2, 100_000, 8_000);
    await wait(300);
    assert.equal((await post(d, "/v1/network/server_remove", { serverId: nodeId }, owner)).status, 200);
    const t0 = Date.now();
    const result = await ended;
    assert.equal(result.ended, true, "the video stream ended");
    assert.ok(Date.now() - t0 < 3_000, `and quickly (${Date.now() - t0} ms)`);
    await Promise.race([sock2.closed, wait(3_000).then(() => { throw new Error("the view socket stayed open"); })]);
    assert.equal(await running, "removed");
    const again = await fetch(`${d.url}/computers/${id}/stream?ticket=${(await post(d, "/v1/computers/stream", { computerId: id }, owner)).json.data?.ticket ?? "none"}`); await again.body?.cancel();
    assert.notEqual(again.status, 200, "no view of a computer whose node is gone");
  } finally {
    for (const o of open) o.close();
    mine.state.stop(); other.state.stop();
    node.abort.abort(); second.node.abort.abort();
    await running.catch(() => undefined); await second.running.catch(() => undefined);
    await d.stop();
    for (const p of [nodeDir, otherDir, dir]) fs.rmSync(p, { recursive: true, force: true });
  }
});
