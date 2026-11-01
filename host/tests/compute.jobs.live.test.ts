// Agent computers on a computer that joined the Space, on a booted daemon: a computer placed on a node is created, woken, slept and removed by jobs the node answers; a job the node ran but could not
// report is never run twice; the node's copy of the agent's home is a working mirror that syncs through the same conflict rules and is wiped at sleep; and a job's token reaches one computer's home only.
// The node here runs in this process (runComputeNode) with a stand-in for Docker: Docker is the one thing this machine may not have. The home mirror is the module's own, over a folder.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
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

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

type Reply = { status: number; json: { data?: any; error?: { code: string; message: string } } };   // eslint-disable-line @typescript-eslint/no-explicit-any
const post = async (d: Daemon, p: string, body: unknown, token?: string, headers: Record<string, string> = {}): Promise<Reply> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as Reply["json"] };
};

async function boot(): Promise<{ d: Daemon; owner: string; dir: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-jobs-space-"));
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_jobs", "--space-name", "Jobs Co", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({ os: "linux", hostname: "jobs-space", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
    fetch: caddyFetch, computeLeaseMs: 700,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
  const device = { deviceName: "Mac", deviceClass: "desktop" };
  assert.equal((await post(d, "/v1/identity/claim_owner", { code, spaceId: "spc_jobs", username: "olivia", displayName: "Olivia", password: PASSWORD, ...device, keys: KEYS })).status, 200);
  const signedIn = await post(d, "/v1/identity/sign_in", { username: "olivia", password: PASSWORD, ...device });
  assert.equal(signedIn.status, 200);
  return { d, owner: signedIn.json.data.session.token as string, dir };
}

/** A directory the node's mirror lives in, as the module's HomeFs: what the computer's home would hold. */
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

/** The node: enrolled once, then run (and re-run after a "crash") against the same data directory. */
function nodeFor(d: Daemon, dataDir: string, extra: { executed: string[]; failResult?: { once: boolean }; abort?: AbortController; homeOf?: (link: HomeLink) => Promise<(k: string, i: any) => Promise<unknown>>; tokens?: Map<string, string>; hold?: Promise<void>; hangOn?: string }): { run(join?: string): Promise<string>; abort: AbortController } {
  const abort = extra.abort ?? new AbortController();
  const deps = (join?: string): NodeDeps => ({
    server: d.url, join, dataDir, name: "Olivia's Mac", signal: abort.signal, now: Date.now, pollMs: 100,
    fetch: async (url, init) => {
      if (extra.failResult?.once && url.endsWith("/compute/result")) { extra.failResult.once = false; abort.abort(); throw new Error("the node died before it could report"); }
      const r = await fetch(url, init);
      if (extra.tokens && url.endsWith("/compute/poll") && r.status === 200) {
        const jobs = ((await r.clone().json()) as { jobs?: Array<{ computerId: string; token: string; kind: string }> }).jobs ?? [];
        for (const j of jobs) if (j.kind === "start") extra.tokens.set(j.computerId, j.token);
      }
      return r as never;
    },
    sleep: (ms, signal) => new Promise<void>((resolve, reject) => { const t = setTimeout(resolve, ms); signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("stopped")); }, { once: true }); }),
    log: () => undefined, facts: () => ({ os: "darwin", arch: "arm64", docker: true, version: "t" }),
    makeHost: (link) => {
      let home: ((k: string, i: any) => Promise<unknown>) | undefined;   // eslint-disable-line @typescript-eslint/no-explicit-any
      return {
        async run(kind, input) {
          extra.executed.push(kind);
          if (kind === "start" && extra.hold) await extra.hold;
          if (extra.hangOn === kind) await new Promise<never>(() => undefined);   // the process dies in the middle of this job
          home ??= extra.homeOf ? await extra.homeOf(link) : undefined;
          if (home) { const r = await home(kind, input); if (r !== undefined) return r; }
          if (kind === "create") return { diskBytes: 1024 };
          if (kind === "stop") return { sessions: [], diskBytes: 2048, homeSynced: true };
          if (kind === "probe") return { running: true, busy: false, tabs: 1 };
          return {};
        },
      };
    },
  });
  return { abort, run: (join) => runComputeNode(deps(join)) };
}

async function enroll(d: Daemon, owner: string, dataDir: string, extra: Parameters<typeof nodeFor>[3]): Promise<{ nodeId: string; running: Promise<string>; node: ReturnType<typeof nodeFor> }> {
  const code = (await post(d, "/v1/network/server_join_code", { idempotencyKey: `jc-${Math.random()}` }, owner)).json.data.code as string;
  const node = nodeFor(d, dataDir, extra);
  const running = node.run(code);
  let waiting: { serverId: string } | undefined;
  for (let i = 0; i < 80 && !waiting; i++) { waiting = (await post(d, "/v1/network/servers", {}, owner)).json.data.servers.find((r: { enrollment?: string }) => r.enrollment === "pending"); if (!waiting) await new Promise((r) => setTimeout(r, 100)); }
  assert.ok(waiting, "the computer shows as waiting");
  assert.equal((await post(d, "/v1/network/server_approve", { serverId: waiting!.serverId }, owner)).status, 200);
  return { nodeId: waiting!.serverId, running, node };
}

async function agent(d: Daemon, owner: string, name: string): Promise<{ agentId: string; folderId: string }> {
  const made = await post(d, "/v1/agents/create", { name, role: `Use ${name}.`, idempotencyKey: `ag-${name}` }, owner);
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const r = d.db!.all("SELECT id, folderId FROM agents_agent WHERE name = ?", name)[0] as { id: string; folderId: string };
  return { agentId: r.id, folderId: r.folderId };
}

test("a computer placed on a node is created, woken, slept and removed by jobs the node answers, and the Space's own machine is never asked", async () => {
  const { d, owner, dir } = await boot();
  const nodeDir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-jobs-node-"));
  const executed: string[] = [];
  const { nodeId, running, node } = await enroll(d, owner, nodeDir, { executed });
  try {
    const { agentId } = await agent(d, owner, "Scout");
    const made = await post(d, "/v1/computers/provision", { agentId, nodeId, idempotencyKey: "pv-1" }, owner);
    assert.equal(made.status, 200, JSON.stringify(made.json));
    const id = made.json.data.computer.computerId as string;
    assert.equal(made.json.data.computer.nodeId, nodeId);
    assert.equal((await post(d, "/v1/computers/wake", { computerId: id }, owner)).json.data.computer.state, "working");
    assert.equal((await post(d, "/v1/computers/sleep", { computerId: id }, owner)).json.data.computer.state, "asleep");
    assert.equal((await post(d, "/v1/computers/remove", { computerId: id }, owner)).status, 200);
    assert.deepEqual(executed.filter((k) => k !== "probe" && k !== "configure"), ["create", "start", "stop", "remove"]);
    // a computer that is not approved, or not a computer that joined, is not a place to run
    assert.equal((await post(d, "/v1/computers/provision", { agentId, nodeId: "srv_nope", idempotencyKey: "pv-2" }, owner)).status, 422);
  } finally { node.abort.abort(); await running.catch(() => undefined); await d.stop(); fs.rmSync(nodeDir, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a job the node ran but died before reporting is not run again: the restarted node answers from what it stored", async () => {
  const { d, owner, dir } = await boot();
  const nodeDir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-jobs-node-"));
  const executed: string[] = [];
  const failResult = { once: false };
  const { nodeId, running, node } = await enroll(d, owner, nodeDir, { executed, failResult });
  try {
    await new Promise((r) => setTimeout(r, 400));   // admitted and polling
    const { agentId } = await agent(d, owner, "Scout");
    failResult.once = true;   // the next answer this node tries to send is the one it dies on
    const made = post(d, "/v1/computers/provision", { agentId, nodeId, idempotencyKey: "pv-k" }, owner);
    const ended = await running.catch((e) => `threw ${String(e)}`);
    assert.equal(ended, "stopped", "the node died after running the job, before the Space heard");
    assert.deepEqual(executed.filter((k) => k === "create"), ["create"], "the job ran once");
    // the same computer comes back with the same data directory: it says what it stored (or, if the Space already handed the job out again, answers from the store); it never runs it again
    const again = nodeFor(d, nodeDir, { executed });
    const second = again.run();
    const out = await made;
    assert.equal(out.status, 200, JSON.stringify(out.json));
    assert.equal(out.json.data.computer.state, "asleep");
    assert.deepEqual(executed.filter((k) => k === "create"), ["create"], "handed out twice, run once");
    const row = d.db!.all("SELECT attempts, state FROM computers_job WHERE kind = 'create'")[0] as { attempts: number; state: string };
    assert.equal(row.state, "done");
    assert.ok(row.attempts <= 2, "the Space never handed it out more than twice");
    again.abort.abort(); await second.catch(() => undefined);
  } finally { node.abort.abort(); await d.stop(); fs.rmSync(nodeDir, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the node's copy of an agent's home is a working mirror: what was edited on the Space while it ran is not lost at sleep, a clash keeps both, and the copy is wiped", async () => {
  const { d, owner, dir } = await boot();
  const nodeDir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-jobs-node-"));
  const executed: string[] = [];
  const { agentId, folderId } = await agent(d, owner, "Scout");
  const mirror = path.join(nodeDir, "computers", agentId, "Vyre");
  // the module's own home mirror, over a folder, calling Files through the job's token; loaded through the host loader, as the node does
  const homeOf = async (link: HomeLink) => {
    const { createHomeSync } = (await fileExportsImporter(ROOT)("computers")) as unknown as { createHomeSync: (o: unknown, d: unknown) => { pass(): Promise<{ failed: number; made?: Array<{ fileId: string }> }> } };
    const sync = createHomeSync({ agentId, computerId: "cmp", fs: dirFs(mirror), manifest: path.join(nodeDir, "computers", agentId, "home-manifest.json") }, { callAs: link.call, putBytes: link.put, now: Date.now, log: () => undefined });
    return async (kind: string): Promise<unknown> => {
      if (kind === "start") { await sync.pass(); return {}; }
      if (kind === "stop") {
        const r = await sync.pass() as { failed: number; made?: Array<{ fileId: string }> };
        // what the node's host does with the files the pass says the agent made (impl.ts announce): name them to the Space through the door
        if (r.made?.length) await link.call(agentId, "made_files", { files: r.made.map((f) => ({ fileId: f.fileId })) });
        return { sessions: [], homeSynced: r.failed === 0 };
      }
      return undefined;
    };
  };
  const { nodeId, running, node } = await enroll(d, owner, nodeDir, { executed, homeOf });
  try {
    const fileIn = async (name: string, text: string) => (await post(d, "/v1/files/create", { folderId, name, content: { text }, idempotencyKey: `f-${name}` }, owner)).json.data.file as { fileId: string; version: number };
    const read = async (fileId: string) => (await post(d, "/v1/files/read", { fileId, as: "text" }, owner)).json.data.text as string;
    const names = (): string[] => (d.db!.all("SELECT name FROM files_file WHERE folder_id = ? AND deleted_at IS NULL", folderId) as Array<{ name: string }>).map((r) => r.name).sort();
    const quiet = await fileIn("quiet.txt", "original quiet");
    const clash = await fileIn("clash.txt", "original clash");
    const made = await post(d, "/v1/computers/provision", { agentId, nodeId, idempotencyKey: "pv-h" }, owner);
    const id = made.json.data.computer.computerId as string;
    assert.equal((await post(d, "/v1/computers/wake", { computerId: id }, owner)).status, 200);
    assert.equal(fs.readFileSync(path.join(mirror, "quiet.txt"), "utf8"), "original quiet", "waking mirrored Files onto the node");
    // while it runs: the Space edits one file, and a file is edited on both sides
    await post(d, "/v1/files/write", { fileId: quiet.fileId, content: { text: "edited on the Space" }, baseVersion: quiet.version }, owner);
    await post(d, "/v1/files/write", { fileId: clash.fileId, content: { text: "clash, Space side" }, baseVersion: clash.version }, owner);
    fs.writeFileSync(path.join(mirror, "clash.txt"), "clash, computer side");
    fs.utimesSync(path.join(mirror, "clash.txt"), new Date(Date.now() - 10_000), new Date(Date.now() - 10_000));
    fs.writeFileSync(path.join(mirror, "made-on-node.txt"), "new on the node");
    fs.utimesSync(path.join(mirror, "made-on-node.txt"), new Date(Date.now() - 10_000), new Date(Date.now() - 10_000));
    // the chat this work is for: the computer's latest step names it
    const chat = await post(d, "/v1/chat/start", { kind: "chat", agentIds: [agentId], idempotencyKey: "chat-made" }, owner);
    const threadId = chat.json.data.thread.threadId as string;
    d.db!.run("INSERT INTO computers_timeline (step_id, computer_id, idx, at, by_who, caption, tool, thread_id) VALUES (?, ?, 9000, ?, 'agent', 'Writing', 'screen', ?)", "stp_nodemade1", id, Date.now(), threadId);
    assert.equal((await post(d, "/v1/computers/sleep", { computerId: id }, owner)).json.data.computer.state, "asleep");
    const cards = ((await post(d, "/v1/chat/messages/list", { threadId }, owner)).json.data.messages as Array<{ blocks?: Array<{ type: string; data: { name: string; fileId: string } }> }>).flatMap((m) => m.blocks ?? []).filter((b) => b.type === "file");
    assert.deepEqual(cards.map((c) => c.data.name), ["made-on-node.txt"], "a file made on the node is said in the chat, once, by the name Files has");
    assert.equal(await read(quiet.fileId), "edited on the Space", "the Space's edit is not overwritten at sleep");
    assert.equal(await read(clash.fileId), "clash, Space side", "Files keeps its version of a clash");
    assert.ok(names().includes("clash (from computer).txt"), `the computer's version is kept beside it: ${JSON.stringify(names())}`);
    assert.ok(names().includes("made-on-node.txt"), "a file made on the node reached Files");
    assert.equal(fs.existsSync(path.join(nodeDir, "computers", agentId)), false, "the copy on the node is wiped at sleep");
  } finally { node.abort.abort(); await running.catch(() => undefined); await d.stop(); fs.rmSync(nodeDir, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
});


test("a node's door into an agent's home is its job token: another computer's home, another call, a guessed token and a finished job are all refused", async () => {
  const { d, owner, dir } = await boot();
  const nodeDir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-jobs-node-"));
  const tokens = new Map<string, string>();
  let release!: () => void;
  const hold = new Promise<void>((r) => { release = r; });
  const { nodeId, running, node } = await enroll(d, owner, nodeDir, { executed: [], tokens, hold });
  try {
    const a = await agent(d, owner, "Scout"), b = await agent(d, owner, "Other");
    const ids: string[] = [];
    for (const x of [a, b]) ids.push((await post(d, "/v1/computers/provision", { agentId: x.agentId, nodeId, idempotencyKey: `pv-${x.agentId}` }, owner)).json.data.computer.computerId as string);
    const credential = (JSON.parse(fs.readFileSync(path.join(nodeDir, "compute-state.json"), "utf8")) as { credential: string }).credential;
    const home = async (token: string, computerId: string, cap: string, input: unknown = { folder: a.folderId }) => (await fetch(`${d.url}/compute/home`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${credential}` }, body: JSON.stringify({ token, computerId, cap, input }) })).status;
    const waking = post(d, "/v1/computers/wake", { computerId: ids[0] }, owner);   // the job is held open, so its token is live
    for (let i = 0; i < 100 && !tokens.has(ids[0]!); i++) await new Promise((r) => setTimeout(r, 50));
    const token = tokens.get(ids[0]!)!;
    assert.ok(token.startsWith("vcj_"), "the node was handed a token with the job");
    assert.equal(await home(token, ids[0]!, "files.list"), 200, "its own computer's home, a home call");
    // the agent can reach more than its home (a shared client folder here); a token reaches only the home
    const agentsFolder = (d.db!.all("SELECT parent_id FROM files_folder WHERE id = ?", a.folderId)[0] as { parent_id: string }).parent_id;
    const shared = (await post(d, "/v1/files/folder/create", { parentId: agentsFolder, name: "Client files", idempotencyKey: "cf-1" }, owner)).json.data.folder.folderId as string;
    const secret = (await post(d, "/v1/files/create", { folderId: shared, name: "retainer.txt", content: { text: "client confidential" }, idempotencyKey: "cf-2" }, owner)).json.data.file.fileId as string;
    assert.equal((await post(d, "/v1/files/read", { fileId: secret, as: "text" }, owner)).status, 200, "the owner, and so the agent acting for them, can reach it");
    assert.equal(await home(token, ids[0]!, "files.list", { folder: shared }), 403, "listing a folder outside the home is refused");
    assert.equal(await home(token, ids[0]!, "files.read", { fileId: secret, as: "text" }), 403, "reading a file outside the home is refused");
    assert.equal(await home(token, ids[0]!, "files.write", { fileId: secret, content: { text: "x" }, baseVersion: 1 }), 403, "writing a file outside the home is refused");
    assert.equal(await home(token, ids[0]!, "files.delete", { fileId: secret }), 403, "deleting a file outside the home is refused");
    assert.equal(await home(token, ids[0]!, "files.create", { folderId: shared, name: "planted.txt", content: { text: "x" }, idempotencyKey: "pl-1" }), 403, "creating outside the home is refused");
    assert.equal(await home(token, ids[0]!, "files.folder.create", { parentId: agentsFolder, name: "Elsewhere", idempotencyKey: "pl-2" }), 403, "a folder next to the home is refused");
    assert.equal(await home(token, ids[0]!, "files.read", { fileId: "fil_nope", as: "text" }), 403, "an unknown file is refused, not guessed");
    assert.equal(await home(token, ids[0]!, "agents.get", { agentId: b.agentId }), 403, "another agent's record is refused");
    assert.equal(await home(token, ids[0]!, "tasks.create", { title: "x", kind: "todo", assigned: { kind: "person", id: "usr_someone_else" }, fileIds: [] }), 403, "a task for anyone but the agent's owner is refused");
    assert.equal(await home(token, ids[0]!, "tasks.create", { title: "x", kind: "todo", assigned: { kind: "person", id: (d.db!.all("SELECT ownerId FROM agents_agent WHERE id = ?", a.agentId)[0] as { ownerId: string }).ownerId }, fileIds: [secret] }), 403, "a task that names a file outside the home is refused");
    // inside the home: read and write work
    const made = await fetch(`${d.url}/compute/home`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${credential}` }, body: JSON.stringify({ token, computerId: ids[0], cap: "files.create", input: { folderId: a.folderId, name: "notes.txt", content: { text: "inside" }, idempotencyKey: "in-1" } }) });
    assert.equal(made.status, 200, "creating inside the home works");
    const inside = ((await made.json()) as { data?: { output: { file: { fileId: string } } }; output?: { file: { fileId: string } } });
    const insideId = (inside.data?.output ?? inside.output)!.file.fileId;
    assert.equal(await home(token, ids[0]!, "files.read", { fileId: insideId, as: "text" }), 200, "reading inside the home works");
    assert.equal(await home(token, ids[0]!, "files.write", { fileId: insideId, content: { text: "inside, edited" }, baseVersion: 1 }), 200, "writing inside the home works");
    assert.equal((await post(d, "/v1/files/read", { fileId: secret, as: "text" }, owner)).json.data.text, "client confidential", "the file outside the home is untouched");
    assert.equal(await home(token, ids[1]!, "files.list"), 403, "the same token for another computer is refused");
    assert.equal(await home(token, ids[0]!, "secrets.reveal", {}), 403, "a call that is not a home call is refused");
    assert.equal(await home("vcj_00ff", ids[0]!, "files.list"), 403, "a guessed token opens nothing");
    assert.equal(await home("", ids[0]!, "files.list"), 403);
    assert.equal((await fetch(`${d.url}/compute/home`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer vcc_00" }, body: JSON.stringify({ token, computerId: ids[0], cap: "files.list", input: {} }) })).status, 401, "and not without the computer's own credential");
    release();
    assert.equal((await waking).status, 200);
    assert.equal(await home(token, ids[0]!, "files.list"), 403, "dead when its job has ended");
  } finally { release(); node.abort.abort(); await running.catch(() => undefined); await d.stop(); fs.rmSync(nodeDir, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a job the node started and never finished is not run again either: the restarted node reports it as interrupted", async () => {
  const { d, owner, dir } = await boot();
  const nodeDir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-jobs-node-"));
  const executed: string[] = [];
  const { nodeId, running, node } = await enroll(d, owner, nodeDir, { executed, hangOn: "create" });
  try {
    const { agentId } = await agent(d, owner, "Scout");
    const made = post(d, "/v1/computers/provision", { agentId, nodeId, idempotencyKey: "pv-i" }, owner);
    for (let i = 0; i < 100 && !executed.includes("create"); i++) await new Promise((r) => setTimeout(r, 30));
    node.abort.abort(); await running;   // killed in the middle of create
    const again = nodeFor(d, nodeDir, { executed });
    const second = again.run();
    const out = await made;
    assert.notEqual(out.status, 200, "the Space is told it did not finish, not that it did");
    assert.equal(executed.filter((k) => k === "create").length, 1, "never run twice");
    const row = d.db!.all("SELECT state, error FROM computers_job WHERE kind = 'create'")[0] as { state: string; error: string };
    assert.equal(row.state, "failed");
    assert.match(row.error, /stopped in the middle/);
    assert.equal((d.db!.all("SELECT * FROM computers_computers") as unknown[]).length, 0, "nothing half-made is left in the register");
    again.abort.abort(); await second.catch(() => undefined);
  } finally { node.abort.abort(); await d.stop(); fs.rmSync(nodeDir, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
});
