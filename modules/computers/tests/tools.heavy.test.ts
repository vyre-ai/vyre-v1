// @heavy docker
// The tools of an agent computer on a real Docker host (P-L2_16b; spec 2.7, ARCH 6.6, 7.2): the handlers over createDockerComputerHost, against the real Engine. A container is made from the
// person-sandbox image with a stand-in for agentd's control program (the real agentd is images/agent-computer, P-L2_17) that answers the `tool` action. What this proves that the scripted
// tests cannot: the JSON of a call survives Docker's exec as one argument (quotes, unicode, a large body), a refusal on stderr with a non-zero exit comes back with its code, a call that
// outlives its time is a timeout, files written by a Files tool are in the folder the host binds, and the tools wake a sleeping computer.
//
// Runs only with VYRE_HEAVY_DOCKER=1 (the l2-heavy job in check.yml sets it). Without it every test here is skipped with its reason; a skip is never a pass of the real thing. With it on,
// nothing is skipped: a missing Docker daemon or image fails the run, so a green run means the proofs ran.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDockerApi, DEFAULT_IMAGE, unixSocketHttp } from "../../../sandbox/src/docker.ts";
import { tarFiles } from "../../../sandbox/src/tar.ts";
import { createDockerComputerHost, FILES_GUEST } from "../impl.ts";
import { bindHost } from "../projections.ts";
import { provision, sleep, wake } from "../handlers/lifecycle.ts";
import { harness, INTAKE } from "../fixtures/harness.ts";
import { tool } from "./tools.fixture.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the 20 s shard never starts containers)";

const suffix = `${process.pid}${Math.random().toString(36).slice(2, 6)}`;
const PREFIX = `vyre-comp-hv${suffix}t-`;
// The stand-in lives in the bound folder: the computer's /tmp is mounted noexec, like the real one, so a program cannot run from it.
const CTL = `${FILES_GUEST}/.agentd-ctl`;
const STATE = "/tmp/agentd-state";
const http = unixSocketHttp();
const api = createDockerApi(http);
const filesRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-comp-tools-heavy-")));

// The stand-in for agentd's control program. `tool` reads the one JSON argument the host sends ({"tool":..,"args":{..},"timeoutMs":..}), keeps it in a file so the test can look at what arrived,
// and answers by tool name. The Files tools do real file work in the bound folder. POSIX sh only.
const CTL_SCRIPT = String.raw`#!/bin/sh
state=${STATE}
root=${FILES_GUEST}
mkdir -p "$state"
case "$1" in
  status) printf '{"tabs":1,"busy":false,"lastFrameAt":1}';;
  configure) printf '{}';;
  sessions) printf '{"sessions":[]}';;
  tool)
    body="$2"
    name=$(printf '%s' "$body" | sed -n 's/^{"tool":"\([a-z_]*\)".*/\1/p')
    printf '%s' "$body" > "$state/last-$name"
    field() { printf '%s' "$body" | sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p"; }
    case "$name" in
      chrome_state) printf '{"url":"https://example.com/","title":"Example","loading":false}';;
      chrome_open) printf '{"tabId":"t1","url":"%s","title":"Opened"}' "$(field url)";;
      chrome_click) printf '{"code":"paused","message":"Esc was pressed"}' >&2; exit 3;;
      chrome_wait) sleep 30; printf '{"ok":true,"waitedMs":30000}';;
      chrome_screenshot) printf '{"png":"iVBORw0KGgo=","width":800,"height":600}';;
      chrome_eval) printf '{"result":"%s"}' "$(field expression)";;
      screen_key) printf '{"ok":true}';;
      computer_files_write)
        p=$(field path); c=$(field content)
        mkdir -p "$(dirname "$root/$p")" && printf '%s' "$c" > "$root/$p" && printf '{"ok":true}';;
      computer_files_read)
        p=$(field path)
        [ -f "$root/$p" ] || { printf '{"code":"not_found","message":"no such file"}' >&2; exit 4; }
        printf '{"content":"%s","encoding":"utf8","truncated":false}' "$(cat "$root/$p")";;
      computer_files_move)
        f=$(field from); t=$(field to)
        mkdir -p "$(dirname "$root/$t")" && mv "$root/$f" "$root/$t" && printf '{"ok":true}';;
      computer_files_delete) rm -f "$root/$(field path)"; printf '{"ok":true}';;
      computer_files_list)
        p=$(field path); out=""
        for f in "$root/$p"/*; do
          [ -e "$f" ] || continue
          n=$(basename "$f"); if [ -d "$f" ]; then k=folder; else k=file; fi
          out="$out{\"name\":\"$n\",\"kind\":\"$k\"},"
        done
        printf '{"entries":[%s]}' "$(printf '%s' "$out" | sed 's/,$//')";;
      *) printf '{"code":"not_found","message":"no tool %s"}' "$name" >&2; exit 5;;
    esac;;
  *) echo "unknown action $1" >&2; exit 2;;
esac
`;

const host = createDockerComputerHost({
  api, http, image: DEFAULT_IMAGE, cmd: ["sleep", "infinity"], prefix: PREFIX, ctl: CTL, filesRoot: () => filesRoot, startTimeoutMs: 40_000, user: { uid: 10001, gid: 10001 },
});

const nameOf = (computerId: string): string => `${PREFIX}${computerId.replace(/^cmt_/, "")}`;
const run = (name: string, cmd: string[]): Promise<{ exitCode: number | null; stdout: string; stderr: string }> => api.exec(name, { cmd, env: [] });

async function installCtl(name: string): Promise<void> {
  await api.putArchive(name, FILES_GUEST, tarFiles([{ path: ".agentd-ctl", data: new TextEncoder().encode(CTL_SCRIPT), mode: 0o755, uid: 10001, gid: 10001, mtime: Math.floor(Date.now() / 1000) }]));
}

/** Wake a computer whose container does not have its control program yet: the program is put in as soon as the container runs. */
async function wakeWithCtl(h: ReturnType<typeof harness>, computerId: string) {
  const name = nameOf(computerId);
  const waking = wake(h.ctx, { computerId });
  for (let i = 0; i < 200 && !(await api.containerRunning(name)); i++) await new Promise((r) => setTimeout(r, 100));
  await installCtl(name);
  return waking;
}

before(async () => {
  if (!ON) return;
  assert.equal(await api.ping(), true, "the Docker daemon answers");
  assert.equal(await api.imageExists(DEFAULT_IMAGE), true, `the image ${DEFAULT_IMAGE} is on this runner`);
  fs.chmodSync(filesRoot, 0o777);
});

after(async () => {
  bindHost(null);
  if (!ON) return;
  const list = await http({ method: "GET", path: "/containers/json", query: { all: "true", filters: JSON.stringify({ name: [PREFIX] }) } });
  const containers = JSON.parse(new TextDecoder().decode(list.body)) as Array<{ Id: string }>;
  // Files the container made belong to its user; remove them from inside before the container goes.
  for (const c of containers) await api.exec(c.Id, { cmd: ["sh", "-c", `rm -rf ${FILES_GUEST}/work ${FILES_GUEST}/big ${FILES_GUEST}/.agentd-ctl`], env: [] }).catch(() => undefined);
  for (const c of containers) await api.containerRemove(c.Id);
  const vols = await http({ method: "GET", path: "/volumes", query: { filters: JSON.stringify({ name: [PREFIX] }) } });
  for (const v of (JSON.parse(new TextDecoder().decode(vols.body)) as { Volumes?: Array<{ Name: string }> }).Volumes ?? []) await http({ method: "DELETE", path: `/volumes/${v.Name}`, query: { force: "true" } });
  try { fs.rmSync(filesRoot, { recursive: true, force: true }); } catch { /* a leftover temp folder is not a failure */ }
});

const code = (e: unknown): string => (e as { error?: { code?: string } } | null)?.error?.code ?? "";

test("@heavy computers tools: Chrome, Screen and Files tools on a real Docker host", { skip, timeout: 420_000 }, async () => {
  const h = harness();
  bindHost(host);
  const made = await provision(h.ctx, { agentId: INTAKE, idempotencyKey: "heavy-tools" });
  const id = made.computer.computerId;
  const name = nameOf(id);
  await wakeWithCtl(h, id);

  // an answer comes from the container, as the capability's output
  const state = await tool["computers.chrome.state"]!(h.ctx, { computerId: id });
  assert.deepEqual(state, { url: "https://example.com/", title: "Example", loading: false });

  // the JSON of a call survives exec as one argument: quotes, an ampersand, unicode
  const odd = "https://example.com/a?b=it's&c=é&d=日本";
  const opened = await tool["computers.chrome.open"]!(h.ctx, { computerId: id, url: odd });
  assert.equal(opened.url, odd);
  const arrived = JSON.parse((await run(name, ["cat", `${STATE}/last-chrome_open`])).stdout) as { tool: string; args: { url: string }; timeoutMs: number };
  assert.equal(arrived.tool, "chrome_open");
  assert.equal(arrived.args.url, odd, "the address reached agentd byte for byte");
  assert.equal(arrived.timeoutMs, 60_000);

  // a screen key reaches agentd with its arguments, and its step is on the timeline
  assert.deepEqual(await tool["computers.screen.key"]!(h.ctx, { computerId: id, combo: "ctrl+l" }), { ok: true });
  assert.deepEqual(JSON.parse((await run(name, ["cat", `${STATE}/last-screen_key`])).stdout).args, { combo: "ctrl+l" });
  assert.deepEqual(h.rows("SELECT caption FROM computers_timeline ORDER BY idx").map((r) => r["caption"]), ["Opened example.com", "Pressed ctrl+l"]);

  // the picture goes to the agent's folder
  const shot = await tool["computers.chrome.screenshot"]!(h.ctx, { computerId: id });
  assert.deepEqual(shot, { fileId: "fil_shot1", width: 800, height: 600 });
  assert.equal((h.calls("files.create")[0]?.input["content"] as { base64: string }).base64, "iVBORw0KGgo=");

  // a refusal on stderr with a non-zero exit comes back with its code and the words
  await assert.rejects(() => tool["computers.chrome.click"]!(h.ctx, { computerId: id, ref: "e1" }), (e: any) => {
    assert.equal(code(e), "provider.unavailable");
    assert.match(e.error.message, /Esc/);
    return true;
  });

  // Files tools do real work in the folder the host binds
  await tool["computers.files.write"]!(h.ctx, { computerId: id, path: "work/notes.md", content: "hello from the computer" });
  assert.equal(fs.readFileSync(path.join(filesRoot, "work/notes.md"), "utf8"), "hello from the computer", "the file is in the agent's folder on the host");
  assert.deepEqual(await tool["computers.files.read"]!(h.ctx, { computerId: id, path: "work/notes.md" }), { content: "hello from the computer", encoding: "utf8", truncated: false });
  assert.deepEqual((await tool["computers.files.list"]!(h.ctx, { computerId: id, path: "work" })).entries, [{ name: "notes.md", kind: "file" }]);
  await tool["computers.files.move"]!(h.ctx, { computerId: id, from: "work/notes.md", to: "work/old/notes.md" });
  assert.equal(fs.existsSync(path.join(filesRoot, "work/old/notes.md")), true);
  assert.equal(fs.existsSync(path.join(filesRoot, "work/notes.md")), false);
  await assert.rejects(() => tool["computers.files.read"]!(h.ctx, { computerId: id, path: "work/notes.md" }), (e) => code(e) === "validation.not_found");
  await tool["computers.files.delete"]!(h.ctx, { computerId: id, path: "work/old/notes.md" });
  assert.equal(fs.existsSync(path.join(filesRoot, "work/old/notes.md")), false);

  // the largest call the host sends travels as one argument
  const big = "x".repeat(85_000);
  await tool["computers.files.write"]!(h.ctx, { computerId: id, path: "big/file.txt", content: big });
  assert.equal(fs.statSync(path.join(filesRoot, "big/file.txt")).size, 85_000);

  // a path that leaves the folder never reaches the container
  const seen = (await run(name, ["ls", STATE])).stdout;
  await assert.rejects(() => tool["computers.files.read"]!(h.ctx, { computerId: id, path: "../../etc/passwd" }), (e) => code(e) === "validation.bad_input");
  assert.equal((await run(name, ["ls", STATE])).stdout, seen);

  // tools in parallel on one computer
  const parallel = await Promise.all([1, 2, 3, 4, 5].map((n) => tool["computers.chrome.eval"]!(h.ctx, { computerId: id, expression: `n${n}` })));
  assert.deepEqual(parallel.map((p) => p.result), ["n1", "n2", "n3", "n4", "n5"]);

  // a call that outlives its time is a timeout, whatever the container is doing
  const t0 = Date.now();
  await assert.rejects(() => tool["computers.chrome.wait"]!(h.ctx, { computerId: id, until: "time", value: "50", timeoutMs: 100 }), (e) => code(e) === "timeout.deadline");
  assert.ok(Date.now() - t0 < 25_000, `the timeout came after the margin (${Date.now() - t0} ms), not after the 30 s the container slept`);

  // asleep: the container stops; the next tool wakes it, and the same answer comes back
  await sleep(h.ctx, { computerId: id });
  assert.equal(await api.containerRunning(name), false);
  assert.equal((await tool["computers.chrome.state"]!(h.ctx, { computerId: id })).title, "Example");
  assert.equal(await api.containerRunning(name), true, "the tool woke the computer");
  assert.equal(h.rows("SELECT state FROM computers_computers")[0]?.["state"], "working");
});
