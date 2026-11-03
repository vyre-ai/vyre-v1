// What a CLI engine may touch (owner rulings 3 Nov), as the one builder makes it and as Seatbelt and bwrap apply it: on the person's own computer their added folders, the package locations and the
// configs open, Vyre's data folder and the key stores closed even inside an added folder, the turn's own folders open again after; on a server only the Space's toolbox. Plain JSON throughout.
import test from "node:test";
import assert from "node:assert/strict";
import { accessFromEnv, addedFolder, engineAccess, seatbeltProfile, sshFiles, validateSpec } from "../src/index.ts";
import { bwrapWallCommand } from "../src/net/index.ts";

const HOME = "/Users/dana";
const DATA = "/Users/dana/Library/Application Support/ai.vyre.desktop/personal";
const WORK = `${DATA}/work/usr_dana/thr_1`;
const SCRATCH = `${DATA}/scratch/usr_dana`;
const has = new Set([`${HOME}/.gitconfig`, `${HOME}/.ssh/known_hosts`, "/opt/homebrew", `${HOME}/.local`]);

test("own computer: added folders and package locations open, Vyre's data folder and key stores closed, configs read only; the result survives JSON", () => {
  const a = engineAccess({ where: "own", home: HOME, dataDir: DATA, platform: "darwin", folders: [`${HOME}/code/site`, HOME, "/", "/etc", `${DATA}/vault`, "relative/x"], own: [WORK, SCRATCH], sshAuthSock: "/private/tmp/com.apple.launchd.x/Listeners", exists: (p) => has.has(p) });
  assert.deepEqual(a.rw.slice(0, 2), [`${HOME}/code/site`, HOME], "the root, a system folder, the data folder and a relative path are not folders an engine may hold");
  for (const p of [`${HOME}/.npm`, `${HOME}/.cargo`, `${HOME}/go`, `${HOME}/.nvm`, `${HOME}/Library/Caches/Homebrew`, "/opt/homebrew"]) assert.ok(a.rw.includes(p), p);
  assert.ok(!a.rw.includes("/usr/local/Homebrew"), "a Homebrew prefix that is not on this machine is not opened");
  for (const p of [DATA, `${HOME}/.ssh`, `${HOME}/.aws`, `${HOME}/Library/Keychains`, `${HOME}/Library/Application Support/Google/Chrome`, `${HOME}/Library/Cookies`]) assert.ok(a.deny.includes(p), p);
  assert.deepEqual(a.roFiles, [`${HOME}/.gitconfig`, `${HOME}/.ssh/known_hosts`]);
  assert.deepEqual(a.reopen, [WORK, SCRATCH]);
  assert.equal(a.env["PYTHONUSERBASE"], `${HOME}/.local`);
  assert.equal(a.env["GIT_CONFIG_GLOBAL"], `${HOME}/.gitconfig`);
  assert.equal(a.sshAuthSock, "/private/tmp/com.apple.launchd.x/Listeners");
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
  assert.equal(addedFolder(`${DATA}/../personal/work`, DATA), null, "a path that climbs into the data folder is refused");
});

test("server: only the Space's toolbox, and the package managers install into it", () => {
  const a = engineAccess({ where: "server", home: "/root", dataDir: "/data", platform: "linux", folders: ["/home/dana/code"], own: ["/data/work/usr_dana/thr_1"] });
  assert.deepEqual(a.rw, ["/data/toolbox"], "a member's folders are never on a server");
  assert.equal(a.env["npm_config_prefix"], "/data/toolbox/npm");
  assert.equal(a.env["PYTHONUSERBASE"], "/data/toolbox/python");
  assert.ok(a.pathAdd.includes("/data/toolbox/npm/bin"));
  assert.equal(a.sshAuthSock, undefined);
  assert.deepEqual(a.deny, []);
});

test("Seatbelt: later rules win, so the order is open, then close, then the configs, then the turn's own folders; the SSH agent socket is the one extra socket", () => {
  const a = engineAccess({ where: "own", home: HOME, dataDir: DATA, platform: "darwin", folders: [HOME], own: [WORK, SCRATCH], sshAuthSock: "/private/tmp/agent.sock", exists: (p) => has.has(p) });
  const checked = validateSpec({ id: "vyre-sbx-dana", person: "usr_dana", kind: "seatbelt", mounts: [{ host: WORK, mode: "rw" }], scratch: SCRATCH, egressHosts: [] }, { work: [`${DATA}/work`], scratch: [`${DATA}/scratch`] });
  const prof = seatbeltProfile(checked, { proxyPort: 4242, access: a });
  const at = (needle: string): number => { const i = prof.indexOf(needle); assert.ok(i >= 0, needle); return i; };
  const open = at(`(allow file-read* file-write* (subpath "${HOME}")`);
  const close = at(`(deny file-read* file-write* (subpath "${DATA}")`);
  const known = at(`(allow file-read* (subpath "${HOME}/.gitconfig") (subpath "${HOME}/.ssh/known_hosts"))`);
  const work = at(`(allow file-read* file-write* (subpath "${WORK}"))`);
  assert.ok(open < close && close < known && known < work);
  assert.match(prof, /\(deny file-read\* file-write\* [^\n]*\(subpath "\/Users\/dana\/\.ssh"\)/);
  assert.match(prof, /\(allow network-outbound \(remote unix-socket \(subpath "\/private\/tmp\/agent\.sock"\)\)\)/);
  assert.deepEqual(sshFiles(a, "/x/.vyre-known-hosts"), { knownHosts: ["/x/.vyre-known-hosts", `${HOME}/.ssh/known_hosts`] });
});

test("bwrap: the folders bound, an empty folder over a closed one inside them, the configs after, the work folder last; the tools' variables and PATH", () => {
  const home = "/home/dana";
  const data = "/home/dana/.local/share/vyre";
  const work = `${data}/work/usr_dana/thr_1`;
  const made = new Set([`${home}/.local/bin`, `${home}/.cargo/bin`, `${home}/.local`]);
  const a = engineAccess({ where: "own", home, dataDir: data, platform: "linux", folders: ["/srv/code"], own: [work], exists: (p) => made.has(p) });
  // the real file system decides which closed folders exist, so these are folders that exist on every Linux runner
  const acc = { ...a, rw: [...a.rw, "/proc/self"], deny: ["/proc/self/fd"] };
  const w = bwrapWallCommand({ id: "vyre-sbx-dana", person: "usr_dana", kind: "bwrap", mounts: [{ host: work, mode: "rw" }], egressHosts: [] }, { work: [`${data}/work`], scratch: [] }, ["/bin/true"], { wallDir: "/tmp/w", node: "/usr/bin/node", access: acc, basePath: "/usr/bin:/bin" }, { realpath: (p) => p });
  const args = w.args.join(" ");
  assert.ok(args.indexOf("--bind-try /srv/code /srv/code") < args.indexOf("--tmpfs /proc/self/fd"));
  assert.ok(args.indexOf("--tmpfs /proc/self/fd") < args.indexOf(`--bind ${work} ${work}`));
  const env = Object.fromEntries(w.args.flatMap((x, i) => (x === "--setenv" ? [[w.args[i + 1], w.args[i + 2]]] : [])));
  assert.equal(env["PYTHONUSERBASE"], `${home}/.local`);
  assert.equal(env["PATH"], `${home}/.local/bin:${home}/.cargo/bin:/usr/bin:/bin`, "only the bin folders that are there");
  assert.equal(env["CARGO_HOME"], undefined, "a tool the person has not set up keeps its default under the engine's home");
});

test("what the Space asks travels as JSON and nothing else is taken", () => {
  assert.deepEqual(accessFromEnv(JSON.stringify({ where: "own", folders: ["/Users/dana/code"] })), { where: "own", folders: ["/Users/dana/code"] });
  for (const bad of [undefined, "", "x", JSON.stringify({ where: "everywhere", folders: [] }), JSON.stringify({ where: "own", folders: [1] })]) assert.equal(accessFromEnv(bad), null);
});
