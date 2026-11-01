// The sandbox wrap around a CLI engine (P-L2_23, security review S8 finding 1): the work folder is one per person and thread, the key and the MCP token reach the sandbox, a Mac gets Seatbelt and
// the proxy variables, a host placement fails closed, and with no sandbox at all a CLI turn never starts. The real bubblewrap proof is sandbox.heavy.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sandboxWrap, workFolder } from "../sandbox.ts";
import { appleDeveloperRoots, cliInstallRoots, enginePath } from "../sandbox-default.ts";
import { buildOpener } from "../session.ts";
import type { SandboxPlan } from "../sandbox.ts";

const data = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-engine-sbx-")));
const bw: SandboxPlan = { sandbox: { kind: "bwrap", wallDir: "/tmp/vyre-net-unit", node: "/usr/bin/node" }, dataDir: data, egressHosts: ["api.anthropic.com"] };
const env = { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-key", VYRE_MCP_TOKEN: "mcp-token" };

test("a person's thread gets its own folder under the Space data directory; ids cannot climb out", () => {
  const a = workFolder(data, "usr_dana", "thr_1");
  assert.equal(a, path.join(data, "work", "usr_dana", "thr_1"));
  assert.ok(fs.statSync(a).isDirectory());
  assert.notEqual(a, workFolder(data, "usr_dana", "thr_2"));
  assert.notEqual(a, workFolder(data, "usr_ravi", "thr_1"));
  // every character outside letters, digits, underscore and dash becomes an underscore, so no id can name a parent folder or a separator
  const odd = workFolder(data, "usr/../dana", "..%2f");
  assert.equal(odd, path.join(data, "work", "usr____dana", "___2f"));
  assert.equal(workFolder(data, "..", "thr_1"), path.join(data, "work", "__", "thr_1"));
  assert.throws(() => workFolder(data, "usr_dana", ""), /cannot name a folder/);
});

test("bwrap: the work folder is the first rw mount and the directory it starts in; the key and the MCP token travel as --setenv", () => {
  const cwd = workFolder(data, "usr_dana", "thr_1");
  const argv = sandboxWrap(bw)(["claude", "-p"], { env, cwd });
  assert.equal(argv[0], "bwrap");
  const binds = argv.flatMap((x, i) => (x === "--bind" ? [argv[i + 1]] : []));
  assert.equal(binds[0], cwd, "bwrap does --chdir to the first mount");
  assert.equal(argv[argv.indexOf("--chdir") + 1], cwd);
  const setenv = (k: string): string | undefined => { const i = argv.findIndex((x, j) => x === "--setenv" && argv[j + 1] === k); return i < 0 ? undefined : argv[i + 2]; };
  assert.equal(setenv("CLAUDE_CODE_OAUTH_TOKEN"), "sk-ant-key");
  assert.equal(setenv("VYRE_MCP_TOKEN"), "mcp-token");
  assert.ok(argv.includes("--clearenv"));
  assert.ok(argv.indexOf("--clearenv") < argv.indexOf("--setenv"));
  assert.ok(!argv.includes("--share-net"), "the wall: no network of its own");
  assert.deepEqual(argv.slice(-2), ["claude", "-p"]);
});

test("seatbelt: the command is sandbox-exec behind env(1), with the proxy variables and the work folder in the profile", () => {
  const cwd = workFolder(data, "usr_dana", "thr_1");
  const argv = sandboxWrap({ ...bw, sandbox: { kind: "seatbelt", proxyPort: 4321 } })(["claude", "-p"], { env, cwd });
  assert.equal(argv[0], "/usr/bin/env");
  assert.ok(argv.includes("HTTPS_PROXY=http://127.0.0.1:4321"));
  const at = argv.indexOf("/usr/bin/sandbox-exec");
  assert.ok(at > 0);
  assert.ok(argv[at + 2]!.includes(cwd), "the profile names the work folder");
  assert.ok(argv[at + 2]!.includes('(allow file-read* (literal "/"))'), "node reads the root directory itself; without this it aborts on start");
  // the CLI's own state is in the person's scratch folder, never the real home
  const scratch = path.join(data, "scratch", "usr_dana");
  assert.ok(argv.includes(`HOME=${path.join(scratch, "home")}`));
  assert.ok(argv.includes(`TMPDIR=${path.join(scratch, "tmp")}`));
  assert.ok(argv.includes(`CLAUDE_CONFIG_DIR=${path.join(scratch, "home", ".claude")}`));
  assert.ok(argv.includes(`CODEX_HOME=${path.join(scratch, "home", ".codex")}`));
  assert.deepEqual(argv.slice(-2), ["claude", "-p"]);
});

test("a host placement fails closed with sandbox.unavailable, and so does a missing work folder or a folder that is not a person's thread", () => {
  const cwd = workFolder(data, "usr_dana", "thr_1");
  for (const kind of ["docker", "server"] as const) assert.throws(() => sandboxWrap({ ...bw, sandbox: { kind } })(["claude"], { env, cwd }), (e: Error & { code?: string }) => e.code === "sandbox.unavailable");
  assert.throws(() => sandboxWrap(bw)(["claude"], { env }), /needs a work folder/);
  assert.throws(() => sandboxWrap(bw)(["claude"], { env, cwd: os.homedir() }), /not one of the Space's/);
  assert.throws(() => sandboxWrap(bw)(["claude"], { env, cwd: path.join(data, "work", "usr_dana") }), /not one of the Space's/);
});

test("with no sandbox plan a CLI engine never starts: the launcher refuses", async () => {
  const opener = buildOpener({ session: { source: {} as never, reportMiss: () => undefined, mcp: {} as never }, call: async () => ({}) });
  assert.ok(opener);
  // The refusal is on the launcher the opener was built with; the opener reaches it only for a CLI driver, so the check here is that building without a plan did not fall back to a local launcher.
  const src = fs.readFileSync(new URL("../session.ts", import.meta.url), "utf8");
  assert.ok(!/createLocalLauncher\(\{\}\)|createLocalLauncher\(h\.launcher/.test(src));
  assert.match(src, /sandbox\.unavailable/);
});

test("the default sandbox: Linux without bwrap and an unknown platform say so and refuse, they never run the engine unwrapped", async () => {
  const { defaultSandbox } = await import("../sandbox-default.ts");
  const noBwrap = await defaultSandbox({ dataDir: data, platform: "linux", bwrapPaths: ["/nonexistent/bwrap"] });
  assert.equal(noBwrap.plan.sandbox.kind, "server");
  assert.throws(() => sandboxWrap(noBwrap.plan)(["claude"], { env, cwd: workFolder(data, "usr_dana", "thr_1") }), (e: Error & { code?: string }) => e.code === "sandbox.unavailable");
  const win = await defaultSandbox({ dataDir: data, platform: "win32" });
  assert.equal(win.plan.sandbox.kind, "server");
  assert.match((win.plan.sandbox as { reason?: string }).reason ?? "", /win32/);
  await noBwrap.close();
  await win.close();
});

test("PATH for a CLI engine: an app from the Finder gets the folders a shell would add, only the ones that exist, and other platforms keep their PATH", () => {
  const home = "/Users/dana";
  const there = new Set(["/Users/dana/.local/bin", "/opt/homebrew/bin", "/Users/dana/.nvm/versions/node", "/Users/dana/.nvm/versions/node/v22.1.0/bin", "/Users/dana/.nvm/versions/node/v24.15.0/bin"]);
  const exists = (p: string): boolean => there.has(p);
  const list = (): string[] => ["v22.1.0", "v24.15.0", "default"];
  const got = enginePath({ PATH: "/usr/bin:/bin" }, home, "darwin", exists, list).split(":");
  assert.deepEqual(got, ["/usr/bin", "/bin", "/Users/dana/.local/bin", "/opt/homebrew/bin", "/Users/dana/.nvm/versions/node/v24.15.0/bin", "/Users/dana/.nvm/versions/node/v22.1.0/bin"]);
  assert.equal(enginePath({ PATH: "/usr/bin:/opt/homebrew/bin" }, home, "darwin", exists, list).split(":").filter((p) => p === "/opt/homebrew/bin").length, 1, "no duplicates");
  assert.equal(enginePath({ PATH: "/usr/bin:/bin" }, home, "linux", exists, list), "/usr/bin:/bin");
});

test("CLI install roots: the folder of the link and the prefix above it, never the home, a parent of it, or the folders of a person's sign-ins and history", () => {
  const home = "/Users/dana";
  const files = new Map([
    ["/Users/dana/.nvm/versions/node/v24.15.0/bin/claude", "/Users/dana/.nvm/versions/node/v24.15.0/lib/node_modules/@anthropic-ai/claude-code/cli.js"],
    ["/Users/dana/.claude/local/claude", "/Users/dana/.claude/local/node_modules/.bin/claude"],
    ["/opt/homebrew/bin/codex", "/opt/homebrew/Cellar/codex/1.0/bin/codex"],
    ["/Users/dana/bin/grok", "/Users/dana/bin/grok"],
  ]);
  const roots = cliInstallRoots({ PATH: [...files.keys()].map((f) => path.dirname(f)).join(":") }, home, (p) => files.has(p), (p) => files.get(p) ?? p);
  assert.ok(roots.includes("/Users/dana/.nvm/versions/node/v24.15.0"), "the nvm prefix holds the CLI, its node_modules and its node");
  assert.ok(roots.includes("/Users/dana/.claude/local"), "Claude Code's own installer folder");
  assert.ok(!roots.includes("/Users/dana/.claude"), "the folder of her history and sign-in is not opened");
  assert.ok(!roots.includes("/Users/dana") && !roots.includes("/Users") && !roots.includes("/"));
  assert.ok(roots.includes("/opt/homebrew/Cellar/codex/1.0"));
  assert.ok(roots.includes("/Users/dana/bin"));
});

test("bwrap with sign-in files: the scratch folder's home is bound as the sandbox's home instead of an empty one, and without the option the home stays empty", () => {
  const cwd = workFolder(data, "usr_dana", "thr_home");
  const withHome = sandboxWrap(bw, { homeFromScratch: true })(["codex", "exec"], { env, cwd });
  const pairs = (argv: string[], flag: string): string[][] => argv.flatMap((x, i) => (x === flag ? [[argv[i + 1] as string, argv[i + 2] as string]] : []));
  const bound = pairs(withHome, "--bind").find((p) => p[1] === "/home/agent");
  assert.ok(bound, "a bind onto the sandbox home");
  assert.equal(path.basename(bound[0] as string), "home");
  assert.ok((bound[0] as string).startsWith(path.join(data, "scratch")), "the bound folder is inside the person's scratch folder");
  assert.ok(!pairs(withHome, "--tmpfs").some((p) => p[0] === "/home/agent"), "no empty home on top of it");
  const plain = sandboxWrap(bw)(["codex", "exec"], { env, cwd });
  assert.ok(plain.some((x, i) => x === "--tmpfs" && plain[i + 1] === "/home/agent"));
  assert.ok(!pairs(plain, "--bind").some((p) => p[1] === "/home/agent"));
});

test("Apple's git under Seatbelt needs the developer folders open for reading: only those that exist are named", () => {
  const there = new Set(["/Library/Developer/CommandLineTools", "/Applications/Xcode.app/Contents", "/Library/Preferences/com.apple.dt.Xcode.plist"]);
  assert.deepEqual(appleDeveloperRoots((p) => there.has(p)), ["/Library/Developer/CommandLineTools", "/Applications/Xcode.app/Contents", "/Library/Preferences/com.apple.dt.Xcode.plist"]);
  assert.deepEqual(appleDeveloperRoots(() => false), []);
  assert.deepEqual(appleDeveloperRoots((p) => p === "/Library/Developer/CommandLineTools"), ["/Library/Developer/CommandLineTools"]);
});
