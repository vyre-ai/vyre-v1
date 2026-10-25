// Credentials (S8, ARCH 6.6): a CLI's sign-in files are materialized in RAM for the session and shredded when it ends. In the Docker sandbox they go straight into the container's tmpfs and never touch
// the host's disk; on a person's own machine they live in a RAM directory, mode 0600 in a 0700 folder, and are overwritten (random, then zeros) before they are removed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SandboxError, createCredentialStore, nodeCredFs, startDockerSandbox, untar } from "../src/index.ts";
import type { CredFs, DirEntry, ProxyHandle } from "../src/index.ts";
import { ROOTS, fakeDocker, spec } from "./helpers.ts";

const enc = new TextEncoder();
const bytes = (s: string): Uint8Array => enc.encode(s);
const isPolicy = (e: unknown): boolean => e instanceof SandboxError && e.code === "sandbox.policy";

/** A file system in memory that logs every call and holds the bytes a file has at each moment. */
function memFs() {
  const files = new Map<string, { data: Uint8Array; mode: number }>();
  const dirs = new Map<string, number>();
  const log: string[] = [];
  /** What a file held at the moment it was unlinked. */
  const atUnlink = new Map<string, Uint8Array>();
  const writes: Array<{ path: string; data: Uint8Array }> = [];
  const stuck = new Set<string>();
  const fsys: CredFs = {
    async mkdir(p, mode) { log.push(`mkdir ${p} ${mode.toString(8)}`); if (dirs.has(p)) throw new Error("exists"); dirs.set(p, mode); },
    async writeNew(p, data, mode) { log.push(`write ${p} ${mode.toString(8)}`); if (files.has(p)) throw new Error("exists"); files.set(p, { data: new Uint8Array(data), mode }); },
    async overwrite(p, data) { const f = files.get(p); if (!f) throw new Error("gone"); log.push(`overwrite ${p} ${data.length}`); writes.push({ path: p, data: new Uint8Array(data) }); f.data = new Uint8Array(data); },
    async size(p) { return files.get(p)?.data.length ?? null; },
    async unlink(p) { log.push(`unlink ${p}`); if (stuck.has(p)) throw new Error("busy"); const f = files.get(p); if (!f) throw new Error("gone"); atUnlink.set(p, f.data); files.delete(p); },
    async rmdir(p) { log.push(`rmdir ${p}`); const kids = [...files.keys(), ...dirs.keys()].filter((k) => k.startsWith(`${p}/`)); if (kids.length > 0) throw new Error("not empty"); dirs.delete(p); },
    async list(p): Promise<DirEntry[]> {
      const out = new Map<string, boolean>();
      for (const k of [...files.keys(), ...dirs.keys()]) {
        if (!k.startsWith(`${p}/`)) continue;
        const rest = k.slice(p.length + 1);
        const name = rest.split("/")[0] as string;
        out.set(name, out.get(name) === true || rest.includes("/") || dirs.has(`${p}/${name}`));
      }
      return [...out].map(([name, dir]) => ({ name, dir }));
    },
    async exists(p) { return files.has(p) || dirs.has(p); },
  };
  return { fs: fsys, files, dirs, log, atUnlink, writes, stuck };
}

const ROOT = "/run/user/1000/vyre-creds";
const FILES = [{ path: ".claude/.credentials.json", data: bytes('{"token":"sk-ant-oat01-SECRET"}') }, { path: ".codex/auth.json", data: bytes("codex-secret-token") }];

test("put: files are created exclusively, mode 0600 in folders of 0700, and the store answers where they are", async () => {
  const m = memFs();
  const store = createCredentialStore(m.fs, { root: ROOT });
  const r = await store.put("session-one", FILES);
  assert.equal(r.dir, `${ROOT}/session-one`);
  assert.deepEqual(r.paths, [`${ROOT}/session-one/.claude/.credentials.json`, `${ROOT}/session-one/.codex/auth.json`]);
  for (const d of [ROOT, `${ROOT}/session-one`, `${ROOT}/session-one/.claude`, `${ROOT}/session-one/.codex`]) assert.equal(m.dirs.get(d), 0o700, d);
  for (const p of r.paths) assert.equal(m.files.get(p)?.mode, 0o600, p);
  assert.equal(new TextDecoder().decode(m.files.get(r.paths[0] as string)?.data), '{"token":"sk-ant-oat01-SECRET"}');
});

test("shred: every file is overwritten with random bytes, then zeros, before it is removed; the folders go last; nothing is left", async () => {
  const m = memFs();
  let n = 0;
  const store = createCredentialStore(m.fs, { root: ROOT, random: (len) => new Uint8Array(len).fill(0xa0 + (n++ % 8)) });
  const { paths } = await store.put("session-one", FILES);
  const secrets = paths.map((p) => new TextDecoder().decode(m.files.get(p)?.data));
  const out = await store.shred("session-one");
  assert.equal(out.files, 2);
  assert.equal(m.files.size, 0);
  assert.deepEqual([...m.dirs.keys()], [ROOT], "only the root, which holds nothing, remains");
  for (const p of paths) {
    const i = m.log.findIndex((l) => l.startsWith(`overwrite ${p} `));
    const j = m.log.indexOf(`unlink ${p}`);
    assert.ok(i >= 0 && j > i, `${p} is overwritten before it is removed`);
    assert.equal(m.log.filter((l) => l.startsWith(`overwrite ${p} `)).length, 2, "two passes");
    const passes = m.writes.filter((w) => w.path === p);
    assert.ok(passes[0]!.data.every((b) => b >= 0xa0), "the first pass is random");
    assert.ok(passes[1]!.data.every((b) => b === 0), "the second pass is zeros");
    assert.ok(m.atUnlink.get(p)!.every((b) => b === 0), "what was on disk when it was unlinked is zeros");
  }
  for (const s of secrets) for (const w of m.writes) assert.equal(new TextDecoder().decode(w.data).includes(s), false);
  m.log.forEach((l, i) => {
    if (!l.startsWith("rmdir ")) return;
    const dir = l.slice(6);
    const inside = m.log.map((x, j) => [x, j] as const).filter(([x]) => x.startsWith(`unlink ${dir}/`));
    assert.ok(inside.length > 0 && inside.every(([, j]) => j < i), `${dir} is removed after every file in it`);
  });
  assert.deepEqual(await store.shred("session-one"), { files: 0 }, "shredding twice is safe");
});

test("shred ends the session's files even when one cannot be removed: the rest go, the error says how many are left, and a later try finishes", async () => {
  const m = memFs();
  const store = createCredentialStore(m.fs, { root: ROOT });
  const { paths } = await store.put("session-one", FILES);
  m.stuck.add(paths[0] as string);
  await assert.rejects(() => store.shred("session-one"), (e: unknown) => e instanceof SandboxError && e.code === "sandbox.shred" && /1 credential file/.test(e.message));
  assert.equal(m.files.has(paths[1] as string), false, "the other file was still shredded");
  assert.ok(m.atUnlink.get(paths[1] as string)!.every((b) => b === 0));
  assert.ok(m.writes.some((w) => w.path === paths[0] && w.data.every((b) => b === 0)), "the stuck file's content was destroyed even though it could not be removed");
  m.stuck.clear();
  await store.shred("session-one");
  assert.equal(m.files.size, 0);
});

test("put refuses a path that climbs, is absolute or repeats, and takes back what it had written", async () => {
  for (const bad of ["../x", "/etc/x", "a//b", "a/./b", "", "a/../../b", ".claude/../../x"]) {
    const m = memFs();
    const store = createCredentialStore(m.fs, { root: ROOT });
    await assert.rejects(() => store.put("session-one", [{ path: "ok.json", data: bytes("secret") }, { path: bad, data: bytes("x") }]), isPolicy, JSON.stringify(bad));
    assert.equal(m.files.size, 0, `${JSON.stringify(bad)}: the first file was taken back`);
    assert.equal([...m.dirs.keys()].filter((d) => d !== ROOT).length, 0, "and its folder");
  }
  const m = memFs();
  const store = createCredentialStore(m.fs, { root: ROOT });
  for (const id of ["../x", "A", "ab", "a/b", "x".repeat(70), ""]) {
    await assert.rejects(() => store.put(id, FILES), isPolicy, id);
    await assert.rejects(() => store.shred(id), isPolicy, id);
  }
  assert.throws(() => createCredentialStore(m.fs, { root: "relative/dir" }), isPolicy);
});

test("a second put for a live session fails instead of overwriting", async () => {
  const m = memFs();
  const store = createCredentialStore(m.fs, { root: ROOT });
  await store.put("session-one", FILES);
  await assert.rejects(() => store.put("session-one", FILES));
});

test("shredAll at start-up clears whatever a crashed run left, folders and stray files alike", async () => {
  const m = memFs();
  const store = createCredentialStore(m.fs, { root: ROOT });
  await store.put("old-one", FILES);
  await store.put("old-two", [{ path: "a.json", data: bytes("leftover") }]);
  m.files.set(`${ROOT}/stray`, { data: bytes("stray secret"), mode: 0o600 });
  const out = await store.shredAll();
  assert.deepEqual(out, { sessions: 2, files: 4 });
  assert.equal(m.files.size, 0);
  assert.ok(m.atUnlink.get(`${ROOT}/stray`)!.every((b) => b === 0));
  assert.deepEqual(await createCredentialStore(memFs().fs, { root: ROOT }).shredAll(), { sessions: 0, files: 0 });
});

// ---- the real file system

test("on disk: modes are 0600 and 0700, the content is overwritten and gone after shred, and a link planted in the folder is never followed", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-creds-test-"));
  try {
    const victim = path.join(base, "victim.txt");
    fs.writeFileSync(victim, "do not touch");
    const store = createCredentialStore(await nodeCredFs(), { root: path.join(base, "creds") });
    const { dir, paths } = await store.put("session-one", FILES);
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(dir, ".claude")).mode & 0o777, 0o700);
    for (const p of paths) assert.equal(fs.statSync(p).mode & 0o777, 0o600, p);
    assert.equal(fs.readFileSync(paths[1] as string, "utf8"), "codex-secret-token");

    // A link put in the folder points at a file outside: shredding removes the link and leaves the file alone.
    fs.symlinkSync(victim, path.join(dir, "planted"));
    await store.shred("session-one");
    assert.equal(fs.existsSync(dir), false);
    assert.equal(fs.readFileSync(victim, "utf8"), "do not touch");
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test("on disk: a file is created only if it is new and is not a link, so a planted link cannot redirect a write", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-creds-test-"));
  try {
    const victim = path.join(base, "victim.txt");
    fs.writeFileSync(victim, "do not touch");
    const cfs = await nodeCredFs();
    fs.symlinkSync(victim, path.join(base, "link"));
    await assert.rejects(() => cfs.writeNew(path.join(base, "link"), bytes("secret"), 0o600));
    assert.equal(fs.readFileSync(victim, "utf8"), "do not touch");
    await cfs.writeNew(path.join(base, "fresh"), bytes("secret"), 0o600);
    await assert.rejects(() => cfs.writeNew(path.join(base, "fresh"), bytes("again"), 0o600), "an existing file is not replaced");
    assert.equal(await cfs.size(path.join(base, "fresh")), 6);
    assert.equal(await cfs.size(path.join(base, "link")), 0, "a link has no size of its own");
    assert.equal(await cfs.size(path.join(base, "missing")), null);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// ---- the Docker sandbox

async function dockerSandbox() {
  const d = fakeDocker();
  const startProxy = async (): Promise<ProxyHandle> => ({ port: 4040, close: async () => undefined });
  const sbx = await startDockerSandbox(spec(), { api: d.api, roots: ROOTS, startProxy, now: () => 1_760_000_000_000 });
  return { d, sbx };
}

test("Docker: credentials are written inside the container's home tmpfs by a short exec as the sandbox user (the archive endpoint refuses a read-only root), 0600 with 0700 folders; nothing is written on the host", async () => {
  const { d, sbx } = await dockerSandbox();
  await sbx.putCredentials(FILES);
  assert.equal(d.archives.length, 0, "no archive upload: a read-only root refuses it");
  assert.equal(d.execs.length, 2);
  for (const e of d.execs) {
    assert.deepEqual(e.cmd.slice(0, 2), ["sh", "-c"]);
    assert.match(e.cmd[2]!, /^umask 077; mkdir -p .* base64 -d > .* chmod 600/);
    assert.equal(e.cmd.join(" ").includes("SECRET"), false, "the bytes are not in the arguments");
  }
  const sent = d.execs.map((e) => Object.fromEntries(e.env.map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)])));
  assert.deepEqual(sent.map((s) => s["VYRE_CRED_PATH"]), ["/home/agent/.claude/.credentials.json", "/home/agent/.codex/auth.json"]);
  assert.equal(Buffer.from(sent[0]!["VYRE_CRED_DATA"] as string, "base64").toString(), '{"token":"sk-ant-oat01-SECRET"}');
  assert.equal(JSON.stringify(d.execs).includes("SECRET"), false, "and not in the clear anywhere else");
  const cfg = [...d.containers.values()][0]!.config;
  assert.ok(cfg.HostConfig.Tmpfs["/home/agent"], "the home is a tmpfs, so the files are in RAM");
  assert.ok(cfg.HostConfig.ReadonlyRootfs, "and nowhere else could they be written");
  assert.ok(!cfg.HostConfig.Binds.some((b) => /\.claude|\.codex|creds/.test(b)), "no bind carries them");
  assert.equal(JSON.stringify(d.calls).includes("SECRET"), false);
  d.script = () => ({ exitCode: 1, stderr: "disk full" });
  await assert.rejects(() => sbx.putCredentials(FILES), /credential upload failed: disk full/);
});

test("Docker: a credential path may not climb, be absolute, or carry a character that could mean something to a shell", async () => {
  const { d, sbx } = await dockerSandbox();
  for (const bad of ["../x", "/etc/x", "a//b", "a/./b", "", ".claude/../../x", "a b", "a;b", "a$(b)", "a'b", "a\nb"]) {
    await assert.rejects(() => sbx.putCredentials([{ path: bad, data: bytes("x") }]), (e: unknown) => e instanceof SandboxError, JSON.stringify(bad));
  }
  assert.equal(d.execs.length, 0);
});

test("Docker: wipe shreds each file by its full path in the container, once; stop wipes before it removes the container, and again is a no-op", async () => {
  const { d, sbx } = await dockerSandbox();
  await sbx.wipeCredentials();
  assert.equal(d.execs.length, 0, "nothing to wipe, nothing run");
  await sbx.putCredentials(FILES);
  await sbx.wipeCredentials();
  assert.equal(d.execs.length, 3, "two writes and one wipe");
  const wipe = d.execs[2]!;
  assert.deepEqual(wipe.cmd.slice(0, 2), ["sh", "-c"]);
  assert.deepEqual(wipe.cmd.slice(4), ["/home/agent/.claude/.credentials.json", "/home/agent/.codex/auth.json"]);
  assert.match(String(wipe.cmd[2]), /shred -n 1 -z -u/);
  await sbx.wipeCredentials();
  assert.equal(d.execs.length, 3, "wiped once");

  await sbx.putCredentials([{ path: ".claude/.credentials.json", data: bytes("again") }]);
  const before = d.calls.length;
  await sbx.stop();
  const after = d.calls.slice(before);
  assert.ok(after.indexOf("exec") >= 0 && after.indexOf("exec") < after.indexOf("containerRemove"), `the wipe comes before the container goes: ${after.join(",")}`);
  await sbx.stop();
  assert.equal(d.calls.slice(before).filter((c) => c === "exec").length, 1);
  await assert.rejects(() => sbx.putCredentials(FILES), (e: unknown) => e instanceof SandboxError && e.code === "sandbox.stopped");
});

test("Docker: a failed wipe does not stop the container from being removed", async () => {
  const { d, sbx } = await dockerSandbox();
  await sbx.putCredentials(FILES);
  d.failOn.add("exec");
  await sbx.stop();
  assert.equal(d.containers.size, 0);
  assert.equal(d.networks.size, 0);
});
