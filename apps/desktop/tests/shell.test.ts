// The desktop shell's contract (V1-SPEC 3.13, ARCH 5.10, 7.13, R13), read from the files the Tauri build uses:
// the web build is the frontend, the vyred sidecar is bundled, the vyre:// scheme and the global shortcut are registered,
// the Mac build is ad-hoc signed, Windows ships an installer, only MIT/Apache crates, and no keychain anywhere.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME_DIRS, SKIP, binaryName, plan } from "../src-tauri/stage-runtime.ts";

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TAURI = path.join(DESKTOP, "src-tauri");
const REPO = path.resolve(DESKTOP, "..", "..");
const read = (...p: string[]): string => fs.readFileSync(path.join(TAURI, ...p), "utf8");
type Conf = {
  productName: string; identifier: string; build: { frontendDist: string };
  app: { withGlobalTauri: boolean; security: { csp: string }; windows: { label: string }[] };
  bundle: { targets: string[]; externalBin: string[]; resources: string[]; icon: string[]; macOS: { signingIdentity: string; hardenedRuntime: boolean }; windows: { nsis: { installMode: string } } };
  plugins: { "deep-link": { desktop: { schemes: string[] } } };
};
const conf = (): Conf => JSON.parse(read("tauri.conf.json")) as Conf;

test("the window loads the Expo web build and the bundle is ad-hoc signed on Mac, NSIS on Windows, deb and AppImage on Linux", () => {
  const c = conf();
  assert.equal(c.productName, "Vyre");
  assert.equal(c.identifier, "ai.vyre.desktop");
  assert.equal(c.build.frontendDist, "../../app/dist");
  assert.ok(fs.existsSync(path.join(REPO, "apps/app/package.json")), "frontendDist belongs to apps/app");
  assert.deepEqual(c.app.windows.map((w) => w.label), ["main"]);
  assert.equal(c.bundle.macOS.signingIdentity, "-", "ad-hoc: no Developer ID needed (F-B)");
  assert.equal(c.bundle.macOS.hardenedRuntime, false);
  for (const t of ["app", "dmg", "nsis", "deb", "appimage"]) assert.ok(c.bundle.targets.includes(t), t);
  assert.equal(c.bundle.windows.nsis.installMode, "currentUser");
  assert.ok(fs.existsSync(path.join(TAURI, "Info.plist")));
});

test("the sidecar is the bundled vyred binary plus the staged runtime, and the page may reach loopback only for its own daemon", () => {
  const c = conf();
  assert.deepEqual(c.bundle.externalBin, ["binaries/vyred"]);
  assert.deepEqual(c.bundle.resources, ["runtime/**/*"]);
  const csp = c.app.security.csp;
  assert.match(csp, /connect-src[^;]*http:\/\/127\.0\.0\.1:\*/);
  assert.match(csp, /script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'/, "sqlite3mc WASM needs wasm-unsafe-eval");
  assert.doesNotMatch(csp, /'unsafe-eval'/);
  assert.match(csp, /worker-src 'self' blob:/);
  const lib = read("src", "lib.rs");
  const side = read("src", "sidecar.rs");
  assert.match(side, /sidecar\("vyred"\)/);
  assert.match(side, /"--role"[\s\S]*"device"/);
  assert.match(side, /"--port"[\s\S]*"0"/, "a free loopback port, read back from the daemon's own line");
  assert.match(side, /host.*src.*daemon.*main\.ts|join\("host"\)\.join\("src"\)\.join\("daemon"\)\.join\("main\.ts"\)/s);
  assert.match(lib, /RunEvent::Exit[\s\S]*sidecar::stop/);
  assert.ok(fs.existsSync(path.join(REPO, "host/src/daemon/main.ts")), "the entry the shell runs exists");
});

test("the daemon prints the line the shell reads", () => {
  const main = fs.readFileSync(path.join(REPO, "host/src/daemon/main.ts"), "utf8");
  assert.match(main, /vyred \$\{version\} \$\{d\.roles\.join\(","\)\} \$\{d\.space \?\? "-"\} listening on \$\{d\.url\}/);
  const side = read("src", "sidecar.rs");
  assert.match(side, /find\("listening on "\)/);
  assert.match(side, /words\.next\(\)\? != "vyred"/);
});

test("the vyre scheme and the global shortcut are registered; single instance is first; links log the action only", () => {
  const c = conf();
  assert.deepEqual(c.plugins["deep-link"].desktop.schemes, ["vyre"]);
  const lib = read("src", "lib.rs");
  assert.match(lib, /SHORTCUT: &str = "CommandOrControl\+Shift\+V"/);
  assert.match(lib, /register_all\(\)/);
  assert.match(lib, /on_open_url/);
  assert.match(lib, /get_current\(\)/);
  assert.ok(lib.indexOf("tauri_plugin_single_instance") < lib.indexOf("tauri_plugin_shell::init"), "single instance registers first");
  const links = read("src", "links.rs");
  for (const a of ["join", "open", "pair", "signin"]) assert.ok(links.includes(`"${a}"`), a);
  const commands = read("src", "commands.rs");
  assert.match(commands, /deep link \{\} received", link\.action/);
  assert.doesNotMatch(commands, /println!\([^)]*params/, "one-time codes never reach a log");
  assert.match(commands, /desktop_info/);
  assert.match(commands, /take_pending_link/);
});

test("the page gets no shell power beyond the listed permissions, and the app has no keychain", () => {
  const caps = JSON.parse(read("capabilities", "default.json")) as { windows: string[]; permissions: (string | object)[] };
  assert.deepEqual(caps.windows, ["main"]);
  assert.deepEqual(caps.permissions, [
    "core:default", "deep-link:default", "global-shortcut:allow-register", "global-shortcut:allow-unregister", "global-shortcut:allow-is-registered",
  ]);
  assert.ok(!JSON.stringify(caps).includes("shell:"), "the page cannot start programs; only the Rust side spawns vyred");
  const cargo = read("Cargo.toml");
  assert.doesNotMatch(cargo, /keyring|keychain|security-framework|secret-service|libsecret/i);
  const lib = read("src", "lib.rs");
  assert.match(lib, /No keychain/);
  assert.match(read("deny.toml"), /name = "keyring"/);
});

test("Rust crates are Tauri 2 and its MIT/Apache plugins only, and the package is MIT", () => {
  const cargo = read("Cargo.toml");
  const deps = cargo.split("[dependencies]")[1]?.split("[profile")[0] ?? "";
  const names = [...deps.matchAll(/^([a-z0-9_-]+)\s*=/gm)].map((m) => m[1]).sort();
  assert.deepEqual(names, ["rusqlite", "serde", "serde_json", "tauri", "tauri-plugin-deep-link", "tauri-plugin-dialog", "tauri-plugin-global-shortcut", "tauri-plugin-notification", "tauri-plugin-shell", "tauri-plugin-single-instance"]);
  assert.match(cargo, /license = "MIT"/);
  const allow = read("deny.toml");
  assert.doesNotMatch(allow, /GPL|AGPL|SSPL/);
});

test("the bundle icons are real images in the formats each platform wants", () => {
  const icons = path.join(TAURI, "icons");
  for (const [name, side] of [["32x32.png", 32], ["128x128.png", 128], ["128x128@2x.png", 256], ["icon.png", 512]] as const) {
    const b = fs.readFileSync(path.join(icons, name));
    assert.equal(b.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", name);
    assert.equal(b.readUInt32BE(16), side, `${name} width`);
    assert.equal(b.readUInt32BE(20), side, `${name} height`);
  }
  const ico = fs.readFileSync(path.join(icons, "icon.ico"));
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2)], [0, 1]);
  assert.equal(fs.readFileSync(path.join(icons, "icon.icns")).subarray(0, 4).toString("ascii"), "icns");
  for (const f of conf().bundle.icon) assert.ok(fs.existsSync(path.join(TAURI, f)), f);
});

test("package scripts build the web export, stage the runtime, then run tauri", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP, "package.json"), "utf8")) as { name: string; scripts: Record<string, string>; dependencies?: object };
  assert.equal(pkg.name, "@vyre/desktop");
  assert.match(pkg.scripts["build"] ?? "", /npm run web && npm run stage && npm run tauri -- build/);
  assert.match(pkg.scripts["web"] ?? "", /expo export --platform web --output-dir dist/);
  assert.match(pkg.scripts["stage"] ?? "", /stage-runtime\.ts/);
  assert.equal(pkg.dependencies, undefined, "the Tauri CLI is fetched by the build, never installed into the workspace");
  const root = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")) as { workspaces: string[] };
  assert.ok(root.workspaces.includes("apps/*"));
});

test("the runtime stage copies the daemon's workspaces, leaves tests out and names the binary by target triple", () => {
  const all = ["lib", "manifest", "contracts", "kernel", "host", "sync", "client", "agent", "sandbox", "modules", "generated", "manifests", "packages", "relay/client", "apps/app", "apps/desktop", "relay/node", "ui"];
  const p = plan(["lib", "host", "apps/app", "relay/node", "ui", "modules/google"], (rel) => all.includes(rel) || rel === "package.json" || rel === "package-lock.json");
  assert.ok(p.copyDirs.includes("host") && p.copyDirs.includes("kernel") && p.copyDirs.includes("generated"));
  assert.deepEqual(p.packageOnly.sort(), ["apps/app", "relay/node", "ui"]);
  assert.deepEqual(p.rootFiles, ["package.json", "package-lock.json"]);
  for (const d of RUNTIME_DIRS) assert.ok(!d.startsWith("apps/") && d !== "ui", d);
  assert.ok(fs.existsSync(path.join(REPO, "host/modules.json")), "the daemon reads host/modules.json from the runtime root");
  for (const bad of ["host/tests/x.ts", "kernel/src/a.test.ts", "images/vyred/smoke.heavy.test.ts", "node_modules/x", "modules/a/tests/b.ts"]) assert.match(bad, SKIP, bad);
  for (const good of ["host/src/daemon/main.ts", "generated/registry.ts", "kernel/src/log/index.ts"]) assert.doesNotMatch(good, SKIP, good);
  assert.equal(binaryName("aarch64-apple-darwin"), "vyred-aarch64-apple-darwin");
  assert.equal(binaryName("x86_64-pc-windows-msvc"), "vyred-x86_64-pc-windows-msvc.exe");
});

test("the Rust unit tests pass where a Rust toolchain exists", { skip: spawnSync("cargo", ["--version"]).status !== 0 && "no cargo on this machine; the desktop job runs them" }, () => {
  const r = spawnSync("cargo", ["test", "--lib", "--manifest-path", path.join(TAURI, "Cargo.toml")], { encoding: "utf8" });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`.slice(-2000));
});

// Final run on the last commit of P-L10_03: the temporary hosted-runner workflow is gone and this file reports its own ok line.
