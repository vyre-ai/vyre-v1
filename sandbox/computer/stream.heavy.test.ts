// @heavy docker
// S9, the agent computer on a real Docker host (spec 2.7, ARCH 6.6): the image builds from images/agent-computer, the container comes up the way modules/computers creates it (all capabilities
// dropped, no new privileges, noexec tmpfs, profile volume, Files folder bound), agentd answers the control protocol through `docker exec /opt/agentd/ctl`, and the live view meets its numbers:
//   - 10 frames a second over MJPEG, and a stream that refuses a viewer without a ticket
//   - take-over input latency under 150 ms (send to acknowledgement, the X server having taken the input, over a WebSocket that is also carrying the frames)
//   - while a person has the controls the agent's tools are refused (paused), and the view takes no input before they do
//   - recording disk use per hour, measured on a desktop with something moving on it
//
// Runs only with VYRE_HEAVY_DOCKER=1. Without it every test here is skipped with its reason; a skip is never a pass of the real thing. With it on, nothing is skipped: a missing Docker daemon or a
// failed image build fails the run. Numbers are printed as METRIC lines.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDockerApi, unixSocketHttp } from "../src/docker.ts";
import type { ContainerConfig } from "../src/docker.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the 20 s shard never builds or starts the agent computer)";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const IMAGE = process.env["VYRE_AGENT_COMPUTER_IMAGE"] ?? "vyre/agent-computer:1";
const CTL = "/opt/agentd/ctl";
const suffix = `${process.pid}${Math.random().toString(36).slice(2, 6)}`;
const NAME = `vyre-comp-hv${suffix}`;
const FILES_GUEST = "/home/agent/Vyre";
const http = unixSocketHttp();
const api = createDockerApi(http);
const filesRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-agentcomp-")));
const exec = (cmd: string[]) => api.exec(NAME, { cmd, env: [], user: "10001:10001" });
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function runHost(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: ROOT, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as NodeJS.ErrnoException & { code?: number }).code as number | undefined) ?? 1 : 0, out: `${stdout}\n${stderr}` });
    });
  });
}

/** The container exactly as modules/computers/impl.ts computerContainerConfig makes it. */
function config(): ContainerConfig {
  const memory = 4096 * 1024 * 1024;
  return {
    Image: IMAGE, Hostname: NAME, User: "", WorkingDir: "/home/agent", Cmd: [],
    Env: ["VYRE_COMPUTER_ID=cmt_hv", "VYRE_AGENT_ID=agt_hv", "VYRE_TAB_LIMIT=4"],
    Labels: { "vyre.computer": "cmt_hv", "vyre.agent": "agt_hv" },
    StopTimeout: 10,
    HostConfig: {
      Binds: [`${NAME}-profile:/home/agent/.profile-disk:rw`, `${filesRoot}:${FILES_GUEST}:rw`],
      ReadonlyRootfs: false,
      Tmpfs: { "/tmp": "rw,nosuid,nodev,noexec,size=1g,uid=10001,gid=10001,mode=1777", "/dev/shm": "rw,nosuid,nodev,noexec,size=1g" },
      CapDrop: ["ALL"], CapAdd: [], SecurityOpt: ["no-new-privileges:true", `seccomp=${JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT, "images/agent-computer/seccomp.json"), "utf8")))}`], Privileged: false, NetworkMode: "bridge", PidMode: "", IpcMode: "private", UsernsMode: "", Devices: [],
      PidsLimit: 1024, Memory: memory, MemorySwap: memory, NanoCpus: 2e9, Init: true, AutoRemove: false,
      Ulimits: [{ Name: "nofile", Soft: 8192, Hard: 16384 }, { Name: "core", Soft: 0, Hard: 0 }],
      LogConfig: { Type: "json-file", Config: { "max-size": "10m", "max-file": "3" } },
      ExtraHosts: [], Dns: [],
    },
  };
}

/** One call to agentd the way the host makes it. A refusal comes back as { refused: { code, message } }. */
async function ctl<T = Record<string, unknown>>(action: string, body: Record<string, unknown> = {}): Promise<T & { refused?: { code: string; message: string } }> {
  const r = await exec([CTL, action, JSON.stringify(body)]);
  if (r.exitCode === 0) return JSON.parse(r.stdout.trim() || "{}") as T;
  const last = r.stderr.trim().split("\n").pop() ?? "";
  return { refused: JSON.parse(last) as { code: string; message: string } } as T & { refused: { code: string; message: string } };
}
/** A tool that acts also returns the picture after the step as `frame` (the timeline's frame); the answers below are compared without it. */
const bare = (o: Record<string, unknown>): Record<string, unknown> => { const { frame: _frame, ...rest } = o; return rest; };
const tool = (name: string, args: Record<string, unknown> = {}) => ctl<Record<string, unknown>>("tool", { tool: name, args, timeoutMs: 30_000 });

/** Split a stream of concatenated JPEGs and call back with each image's bytes. */
function jpegCounter(on: (jpeg: Buffer) => void): (chunk: Buffer) => void {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const s = buf.indexOf(Buffer.from([0xff, 0xd8]));
      if (s < 0) { buf = Buffer.alloc(0); return; }
      const e = buf.indexOf(Buffer.from([0xff, 0xd9]), s + 2);
      if (e < 0) { buf = buf.subarray(s); return; }
      on(buf.subarray(s, e + 2));
      buf = buf.subarray(e + 2);
    }
  };
}

function jpegSize(j: Buffer): { width: number; height: number } | null {
  for (let at = 2; at + 9 < j.length;) {
    if (j[at] !== 0xff) { at += 1; continue; }
    const m = j[at + 1]!;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: (j[at + 5]! << 8) | j[at + 6]!, width: (j[at + 7]! << 8) | j[at + 8]! };
    at += 2 + ((j[at + 2]! << 8) | j[at + 3]!);
  }
  return null;
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))]!;

before(async () => {
  if (!ON) return;
  assert.equal(await api.ping(), true, "the Docker daemon answers");
  const ext = process.env["VYRE_CHROME_EXT_DIR"];
  assert.ok(ext && fs.existsSync(path.join(ext, "manifest.json")), "VYRE_CHROME_EXT_DIR names the Vyre for Chrome folder (apps/chrome manifest.json and src): the agent computer ships with it");
  // The runners have no buildx: the extension goes into a copy of the build context.
  const ctxDir = path.join(filesRoot, "..", `agentcomp-ctx-${suffix}`);
  fs.cpSync(path.join(ROOT, "images/agent-computer"), ctxDir, { recursive: true });
  fs.cpSync(ext!, path.join(ctxDir, "vyre-chrome"), { recursive: true });
  const built = await runHost("docker", ["build", "-t", IMAGE, ctxDir], 1_200_000);
  fs.rmSync(ctxDir, { recursive: true, force: true });
  assert.equal(built.code, 0, `building ${IMAGE} failed: ${built.out.slice(-1500)}`);
  fs.chmodSync(filesRoot, 0o777);
  await api.containerCreate(NAME, config());
  await api.containerStart(NAME);
  // The host waits for agentd the same way: ask until it answers.
  const deadline = Date.now() + 120_000;
  for (;;) {
    const r = await exec([CTL, "status", "{}"]).catch(() => null);
    if (r && r.exitCode === 0) break;
    if (Date.now() > deadline) throw new Error(`agentd did not answer in time: ${r?.stderr.trim() ?? "no answer"}`);
    await sleep(500);
  }
});

after(async () => {
  if (!ON) return;
  await api.exec(NAME, { cmd: ["sh", "-c", `rm -rf ${FILES_GUEST}/work ${FILES_GUEST}/*`], env: [] }).catch(() => undefined);
  await api.containerRemove(NAME).catch(() => undefined);
  await http({ method: "DELETE", path: `/volumes/${NAME}-profile`, query: { force: "true" } }).catch(() => undefined);
  try { fs.rmSync(filesRoot, { recursive: true, force: true }); } catch { /* a leftover temp folder is not a failure */ }
});

test("@heavy agent computer: the container is inside its profile and agentd answers the control protocol", { skip, timeout: 120_000 }, async () => {
  const info = await http({ method: "GET", path: `/containers/${NAME}/json` });
  const j = JSON.parse(new TextDecoder().decode(info.body)) as { State: { Running: boolean }; HostConfig: { Privileged: boolean; CapDrop: string[]; SecurityOpt: string[] }; Config: { User: string } };
  assert.equal(j.State.Running, true);
  assert.equal(j.HostConfig.Privileged, false);
  assert.deepEqual(j.HostConfig.CapDrop, ["ALL"]);
  assert.ok(j.HostConfig.SecurityOpt.includes("no-new-privileges:true"));
  assert.equal(j.Config.User, "10001:10001", "the image runs as the agent user, never root");

  assert.deepEqual(await ctl("configure", { tabLimit: 4 }), {});
  const st = await ctl<{ tabs: number; busy: boolean; diskBytes: number }>("status");
  assert.equal(typeof st.tabs, "number");
  assert.equal(st.busy, false);
  assert.ok(st.diskBytes > 0);
  const shot = await ctl<{ png: string; width: number; height: number }>("screenshot");
  assert.deepEqual([shot.width, shot.height], [1280, 800]);
  assert.equal(Buffer.from(shot.png, "base64").subarray(1, 4).toString("latin1"), "PNG");

  // Vyre for Chrome is part of the computer's browser: the image has it, Chromium was started with it, and its worker is running.
  assert.equal((await exec(["test", "-f", "/opt/vyre-chrome/manifest.json"])).exitCode, 0, "the extension is baked into the image");
  const flag = await exec(["sh", "-c", "ps -eo args | grep -c -- '--load-extension=/opt/vyre-chrome'"]);
  assert.ok(Number(flag.stdout.trim()) >= 1, "Chromium was started with --load-extension");
  let ext = { configured: false, workers: 0 };
  for (let i = 0; i < 40 && ext.workers < 1; i++) { ext = (await ctl<{ extension: { configured: boolean; workers: number } }>("status")).extension; if (ext.workers < 1) await sleep(500); }
  assert.deepEqual(ext.configured, true);
  assert.ok(ext.workers >= 1, "the extension's service worker is running in the browser");

  const who = await exec(["id", "-u"]);
  assert.equal(who.stdout.trim(), "10001");
  const refused = await ctl("no_such_action");
  assert.equal(refused.refused?.code, "bad_input", "an unknown action is refused with a code");
  assert.deepEqual(Object.keys(bare(await tool("chrome_net", { limit: 5 }))), ["requests"], "the debug tools answer");
  assert.deepEqual(Object.keys(bare(await tool("chrome_console"))), ["messages"]);
  assert.deepEqual(Object.keys(bare(await tool("chrome_sources"))).sort(), ["endpoints", "scripts"]);
  assert.equal((await tool("shell_run", { command: "id" })).refused?.code, "bad_input", "there is no way to run a shell command through the tools");
});

test("@heavy S9: the live view runs at 10 frames a second, and refuses a viewer without a ticket", { skip, timeout: 120_000 }, async () => {
  const s = await ctl<{ transport: string; url: string; ws: string }>("stream", { ticket: "tkt_hv" });
  assert.equal(s.transport, "mjpeg");
  const ticketUrl = new URL(s.url);
  assert.ok(ticketUrl.searchParams.get("t"));

  // no ticket and a made-up ticket: refused, and no frames
  for (const bad of [`${ticketUrl.origin}/stream`, `${ticketUrl.origin}/stream?t=${"0".repeat(48)}`]) {
    const r = await fetch(bad);
    assert.equal(r.status, 401, bad);
    await r.body?.cancel();
  }

  const res = await fetch(s.url);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^multipart\/x-mixed-replace/);
  let count = 0;
  let first: Buffer | null = null;
  let t0 = 0;
  let tLast = 0;
  const feed = jpegCounter((jpeg) => { if (!first) { first = jpeg; t0 = performance.now(); } else count += 1; tLast = performance.now(); });
  const stopAt = Date.now() + 8000;
  const reader = res.body!.getReader();
  while (Date.now() < stopAt) {
    const { value, done } = await reader.read();
    if (done) break;
    feed(Buffer.from(value));
  }
  await reader.cancel();
  const seconds = (tLast - t0) / 1000;
  const fps = count / seconds;
  console.log(`METRIC s9.stream.fps=${fps.toFixed(2)} frames=${count} seconds=${seconds.toFixed(2)}`);
  assert.ok(first, "a frame arrived");
  assert.deepEqual(jpegSize(first!), { width: 1280, height: 800 });
  assert.ok(fps >= 8.5 && fps <= 12.5, `${fps.toFixed(2)} frames a second is not 10`);
});

test("@heavy S9: take-over input latency is under 150 ms, the view takes no input before a person has the controls, and the agent's tools wait while they do", { skip, timeout: 180_000 }, async () => {
  const s = await ctl<{ ws: string }>("stream", { ticket: "tkt_hv2" });
  const ws = new WebSocket(s.ws);
  ws.binaryType = "arraybuffer";
  const replies = new Map<number, (m: Record<string, unknown>) => void>();
  let frames = 0;
  ws.addEventListener("message", (ev: MessageEvent) => {
    if (typeof ev.data !== "string") { frames += 1; return; }
    const m = JSON.parse(ev.data) as { seq?: number };
    const w = m.seq === undefined ? undefined : replies.get(m.seq);
    if (w) { replies.delete(m.seq!); w(m as Record<string, unknown>); }
  });
  await new Promise<void>((resolve, reject) => { ws.addEventListener("open", () => resolve()); ws.addEventListener("error", () => reject(new Error("the live view WebSocket did not open"))); });
  let seq = 0;
  const send = (m: Record<string, unknown>): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { replies.delete(id); reject(new Error(`no answer to input ${id}`)); }, 5000);
    replies.set(id, (r) => { clearTimeout(timer); resolve(r); });
    ws.send(JSON.stringify({ ...m, seq: id }));
  });

  // before a person has taken over, the view takes no input
  const early = await send({ t: "move", x: 10, y: 10 });
  assert.equal(early["t"], "refused");

  assert.deepEqual(await ctl("takeover", { personId: "usr_dana" }), {});
  await sleep(300);
  const ms: number[] = [];
  for (let i = 0; i < 60; i++) {
    const x = 100 + (i % 30) * 20;
    const y = 80 + Math.floor(i / 30) * 40;
    const t0 = performance.now();
    const ack = await send({ t: "move", x, y });
    ms.push(performance.now() - t0);
    assert.equal(ack["t"], "ack", JSON.stringify(ack));
    assert.deepEqual([ack["x"], ack["y"]], [x, y], "the X server has the pointer where the person put it");
    await sleep(15);
  }
  console.log(`METRIC s9.takeover.latency_ms median=${median(ms).toFixed(1)} p95=${p95(ms).toFixed(1)} max=${Math.max(...ms).toFixed(1)} n=${ms.length} frames_meanwhile=${frames}`);
  assert.ok(p95(ms) < 150, `p95 ${p95(ms).toFixed(1)} ms is not under 150`);
  assert.ok(median(ms) < 150);
  assert.ok(frames > 0, "the frames kept coming while the person typed");

  // a click and a key reach the desktop too
  const down = await send({ t: "down", n: 1 });
  const up = await send({ t: "up", n: 1 });
  assert.deepEqual([down["t"], up["t"]], ["ack", "ack"]);
  assert.equal((await send({ t: "key", name: "Shift_L", down: true }))["t"], "ack");
  assert.equal((await send({ t: "key", name: "Shift_L", down: false }))["t"], "ack");
  assert.equal((await send({ t: "key", name: "NoSuchKeyName", down: true }))["t"], "refused", "a key that does not exist is refused, not ignored");

  // while the person has the controls the agent's tools are refused
  const blocked = await tool("screen_move", { x: 5, y: 5 });
  assert.equal(blocked.refused?.code, "paused");
  assert.equal((await tool("chrome_open", { url: "about:blank" })).refused?.code, "paused");

  assert.deepEqual(await ctl("give_back"), {});
  assert.equal((await send({ t: "move", x: 20, y: 20 }))["t"], "refused", "the view takes no input once the controls are given back");
  ws.close();
  const back = await tool("screen_move", { x: 5, y: 5 });
  assert.equal(back["ok"], true, "the agent's tools work again once the controls are given back");
  assert.equal(typeof back["frame"], "string", "and the answer carries the picture after the step");
});

test("@heavy S9: recording disk use per hour is measured on a desktop with something moving on it", { skip, timeout: 180_000 }, async () => {
  const opened = await tool("chrome_open", { url: "about:blank" });
  assert.equal(typeof opened["tabId"], "string", JSON.stringify(opened));
  await tool("chrome_eval", {
    expression: `document.body.style.margin = "0"; document.body.innerHTML = '<style>@keyframes m{from{transform:translateX(0)}to{transform:translateX(900px)}}.b{position:absolute;width:200px;height:120px;background:#3b7;animation:m 2s linear infinite alternate}</style>' + [0,1,2,3,4].map((i) => '<div class="b" style="top:' + (60 + i * 130) + 'px;animation-delay:-' + i * 0.4 + 's"></div>').join(""); "ok"`,
  });
  await sleep(1000);

  assert.deepEqual(await ctl("record_start", { recordingId: "rcd_hv1" }), {});
  assert.equal((await ctl("record_start", { recordingId: "rcd_hv1" })).refused?.code, "bad_input", "one recording at a time");
  assert.equal((await ctl("record_start", { recordingId: "../escape" })).refused?.code, "bad_input", "a recording id is not a path");
  await sleep(10_000);
  const out = await ctl<{ events: string; har: string; durationMs: number; bytes: number }>("record_stop", { recordingId: "rcd_hv1" });
  assert.ok(out.durationMs >= 9500, `recorded ${out.durationMs} ms`);
  assert.equal(JSON.parse(out.har).log.version, "1.2");

  const file = path.join(filesRoot, "work", "recordings", "rcd_hv1", "video.mp4");
  const bytes = fs.statSync(file).size;
  const perHour = Math.round((bytes / out.durationMs) * 3_600_000);
  console.log(`METRIC s9.recording.bytes_per_hour=${perHour} bytes=${bytes} seconds=${(out.durationMs / 1000).toFixed(1)} fps=5 codec=h264-ultrafast-crf30`);
  assert.ok(bytes > 10_000, "the video has frames in it");
  assert.equal(fs.readFileSync(file).subarray(4, 8).toString("latin1"), "ftyp", "it is an mp4");
  assert.equal((await ctl("record_stop", { recordingId: "rcd_hv1" })).refused?.code, "not_found", "stopping what is not recording is refused");
});

test("@heavy agent computer: the Files tools work in the bound folder and cannot leave it", { skip, timeout: 120_000 }, async () => {
  assert.deepEqual(await tool("computer_files_write", { path: "notes/a.txt", content: "hello", encoding: "utf8", mode: "overwrite" }), { ok: true });
  assert.equal(fs.readFileSync(path.join(filesRoot, "notes", "a.txt"), "utf8"), "hello", "what the computer writes is in the Files folder");
  assert.deepEqual(await tool("computer_files_read", { path: "notes/a.txt" }), { content: "hello", encoding: "utf8", truncated: false });
  await tool("computer_files_write", { path: "notes/a.txt", content: " there", encoding: "utf8", mode: "append" });
  assert.equal((await tool("computer_files_read", { path: "notes/a.txt" }))["content"], "hello there");
  assert.equal((await tool("computer_files_write", { path: "notes/a.txt", content: "x", mode: "create" })).refused?.code, "bad_input");
  const listed = await tool("computer_files_list", { path: "notes" });
  assert.deepEqual((listed["entries"] as Array<{ name: string; kind: string }>).map((e) => [e.name, e.kind]), [["a.txt", "file"]]);
  assert.deepEqual(await tool("computer_files_move", { from: "notes/a.txt", to: "notes/b.txt" }), { ok: true });
  assert.deepEqual(await tool("computer_files_delete", { path: "notes/b.txt" }), { ok: true });
  assert.equal((await tool("computer_files_read", { path: "notes/b.txt" })).refused?.code, "not_found");

  for (const bad of ["../escape.txt", "/etc/passwd", "notes/../../x", "~/x", "a\\b"]) {
    assert.equal((await tool("computer_files_read", { path: bad })).refused?.code, "bad_input", bad);
    assert.equal((await tool("computer_files_write", { path: bad, content: "x" })).refused?.code, "bad_input", bad);
  }
  // a link inside the folder that points out of it is not followed
  await exec(["ln", "-s", "/etc", `${FILES_GUEST}/outside`]);
  assert.equal((await tool("computer_files_read", { path: "outside/hostname" })).refused?.code, "bad_input");
  assert.equal((await tool("computer_files_write", { path: "outside/new.txt", content: "x" })).refused?.code, "bad_input");
  await exec(["rm", "-f", `${FILES_GUEST}/outside`]);
});

test("@heavy agent computer: a Vault handle is refused while no filler is attached, and an outward click is held until chrome_send", { skip, timeout: 120_000 }, async () => {
  const typed = await tool("screen_type", { text: "#Dana_Lawmatics.password" });
  assert.equal(typed.refused?.code, "unavailable", "the handle itself is never typed");
  assert.match(typed.refused?.message ?? "", /Vault/);

  const opened = await tool("chrome_open", { url: "about:blank" });
  // Vault fill: agentd asks the host for one field at fill time, over the host's channel, and keeps nothing. The host here is a stub that checks the token, the item and logs each use.
  const inspectRes = await http({ method: "GET", path: `/containers/${NAME}/json` });
  const gateway = (JSON.parse(new TextDecoder().decode(inspectRes.body)) as { NetworkSettings: { Gateway: string } }).NetworkSettings.Gateway;
  const TOKEN = "t".repeat(40);
  const uses: string[] = [];
  const stub = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      if (req.headers["authorization"] !== `Bearer ${TOKEN}`) { res.writeHead(401).end("{}"); return; }
      const { handle, field } = JSON.parse(body) as { handle: string; field: string };
      uses.push(`${handle}.${field}`);
      if (handle === "Dana_Portal" && field === "password") res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ value: "s3cret-pw-0042", itemId: "vit_hv1" }));
      else if (handle === "Other_Secret") res.writeHead(403, { "content-type": "application/json" }).end(JSON.stringify({ code: "forbidden" }));
      else res.writeHead(404).end("{}");
    });
  });
  await new Promise<void>((r) => stub.listen(0, "0.0.0.0", () => r()));
  try {
    const port = (stub.address() as { port: number }).port;
    assert.deepEqual(await ctl("configure", { tabLimit: 4, fillUrl: `http://${gateway}:${port}/fill`, fillToken: TOKEN }), {});
    await tool("chrome_eval", { tabId: opened["tabId"], expression: `document.body.innerHTML = '<input id="pw" type="password" aria-label="Password">'; "ok"` });
    const form = String((await tool("chrome_snapshot", { tabId: opened["tabId"] }))["tree"]);
    const pwRef = /\[ref=(e\d+)\]/.exec(form)?.[1] ?? "";
    const filledOut = await tool("chrome_fill", { tabId: opened["tabId"], fields: [{ ref: pwRef, value: "#Dana_Portal.password" }] });
    assert.equal(filledOut["filled"], 1);
    assert.deepEqual(filledOut["used"], [{ handle: "#Dana_Portal.password", itemId: "vit_hv1", value: "s3cret-pw-0042" }], "agentd reports what it used so the host can scrub it");
    assert.deepEqual(uses, ["Dana_Portal.password"], "the host was asked once, for one field");
    assert.equal((await tool("chrome_eval", { tabId: opened["tabId"], expression: "document.getElementById('pw').value.length" }))["result"], 14);
    assert.equal(JSON.stringify(await tool("chrome_snapshot", { tabId: opened["tabId"] })).includes("s3cret-pw-0042"), false, "the page tree never shows the value");
    // nothing on disk: not in /tmp, not on the profile disk, not in the home folder
    const grep = await exec(["sh", "-c", "grep -rIl s3cret-pw-0042 /tmp /home/agent 2>/dev/null | grep -v '^/home/agent/Chrome' | head -3"]);
    assert.equal(grep.stdout.trim(), "", `the value was written to disk: ${grep.stdout}`);
    // the refusals: a handle with no value, an item this agent may not use, a wrong channel token
    assert.equal((await tool("chrome_fill", { tabId: opened["tabId"], fields: [{ ref: pwRef, value: "#Dana_Portal.nothere" }] })).refused?.code, "not_found");
    const denied = await tool("chrome_fill", { tabId: opened["tabId"], fields: [{ ref: pwRef, value: "#Other_Secret.key" }] });
    assert.equal(denied.refused?.code, "bad_input");
    assert.match(denied.refused?.message ?? "", /may not use/);
    assert.equal((await tool("chrome_eval", { tabId: opened["tabId"], expression: "document.getElementById('pw').value.length" }))["result"], 14, "nothing more was typed");
    assert.deepEqual(await ctl("configure", { fillUrl: `http://${gateway}:${port}/fill`, fillToken: "u".repeat(40) }), {});
    assert.equal((await tool("screen_type", { text: "#Dana_Portal.password" })).refused?.code, "unavailable", "a host that does not recognise the channel gives nothing");
  } finally { stub.close(); }
  await tool("chrome_eval", { tabId: opened["tabId"], expression: `document.body.innerHTML = '<button id="b" onclick="document.title=\\'sent\\'">Send message</button><button id="c" onclick="document.title=\\'saved\\'">Save draft</button>'; "ok"` });
  const snap = await tool("chrome_snapshot", { tabId: opened["tabId"] });
  const tree = String(snap["tree"]);
  const refOf = (label: string): string => new RegExp(`button "${label}" \\[ref=(e\\d+)\\]`).exec(tree)?.[1] ?? "";
  assert.ok(refOf("Send message") && refOf("Save draft"), tree);

  const save = await tool("chrome_click", { tabId: opened["tabId"], ref: refOf("Save draft") });
  assert.equal(save["ok"], true);
  assert.equal(save["heldId"], undefined, "a harmless click is done");
  assert.equal((await tool("chrome_state", { tabId: opened["tabId"] }))["title"], "saved");

  const send = await tool("chrome_click", { tabId: opened["tabId"], ref: refOf("Send message") });
  assert.equal(typeof send["heldId"], "string", "a click that sends is held");
  assert.equal((await tool("chrome_state", { tabId: opened["tabId"] }))["title"], "saved", "nothing was sent");
  assert.deepEqual((await tool("chrome_status"))["held"], [send["heldId"]]);
  const sent = await tool("chrome_send", { heldId: send["heldId"] });
  assert.deepEqual(bare(sent), { sent: true });
  assert.equal(typeof sent["frame"], "string", "the step returns its picture for the timeline");
  assert.equal((await tool("chrome_state", { tabId: opened["tabId"] }))["title"], "sent", "chrome_send does what was held");
  assert.equal((await tool("chrome_send", { heldId: send["heldId"] })).refused?.code, "not_found", "a held item is released once");
});
