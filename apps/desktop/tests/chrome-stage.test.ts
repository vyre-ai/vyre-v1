// What the desktop bundle carries for "Install Vyre for Chrome": a folder Chrome can load, with the app's version in its manifest, and the native host the app registers.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stageChromeExtension } from "../src-tauri/stage-runtime.ts";

const walk = (dir: string, base = dir): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name)).split(path.sep).join("/")]));

test("the staged extension is the one Chrome loads: versioned, without tests or package.json, and carrying the native host", () => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-stage-"));
  try {
    const dir = stageChromeExtension(runtime, "1.0.0-rc.3");
    assert.equal(dir, path.join(runtime, "chrome-extension"));
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as { version: string; version_name: string; key: string; background: { service_worker: string } };
    assert.deepEqual([manifest.version, manifest.version_name], ["1.0.0.3", "1.0.0-rc.3"]);
    assert.match(manifest.key, /^MIIB/, "the pinned key travels with it, so the id is the same on every computer");
    const files = walk(dir);
    for (const f of [manifest.background.service_worker, "src/worker/native/host.js", "src/worker/framing.js", "src/worker/native/run.vyre.bridge.json", "src/popup/popup.html", "src/popup/icons/icon-128.png"]) assert.ok(files.includes(f), f);
    assert.ok(!files.some((f) => f === "package.json" || f.startsWith("tests/") || f.includes(".test.")), "no tests, no package.json");
    // staging twice replaces, never merges
    fs.writeFileSync(path.join(dir, "stale.txt"), "old");
    stageChromeExtension(runtime, "1.0.0");
    assert.ok(!fs.existsSync(path.join(dir, "stale.txt")));
    assert.equal((JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as { version: string }).version, "1.0.0");
  } finally {
    fs.rmSync(runtime, { recursive: true, force: true });
  }
});

test("the Rust side registers the commands the page calls, takes no input from the page and writes only the host manifest the extension ships", () => {
  const rs = fs.readFileSync(path.resolve(import.meta.dirname, "../src-tauri/src/chrome.rs"), "utf8");
  const lib = fs.readFileSync(path.resolve(import.meta.dirname, "../src-tauri/src/lib.rs"), "utf8");
  for (const c of ["install_chrome_extension", "open_chrome_extensions", "reveal_chrome_extension", "link_chrome_space", "unlink_chrome_space"]) assert.match(lib, new RegExp(`chrome::${c}\\b`), c);
  assert.match(rs, /pub async fn install_chrome_extension\(app: AppHandle\)/);
  assert.match(rs, /pub fn open_chrome_extensions\(\)/);
  assert.match(rs, /pub fn reveal_chrome_extension\(app: AppHandle\)/);
  assert.match(rs, /include_str!\("\.\.\/\.\.\/\.\.\/chrome\/src\/worker\/native\/run\.vyre\.bridge\.json"\)/, "the template is the extension's own");
});

test("the shell hands a Team Space session to the daemons over loopback with their own token, only for a Space id, and again when a daemon starts", () => {
  const rs = fs.readFileSync(path.resolve(import.meta.dirname, "../src-tauri/src/chrome.rs"), "utf8");
  const side = fs.readFileSync(path.resolve(import.meta.dirname, "../src-tauri/src/sidecar.rs"), "utf8");
  assert.match(rs, /fn space_id_ok\(id: &str\) -> bool/);
  assert.match(rs, /\/local\/chrome\/spaces/);
  assert.match(side, /Authorization: Bearer \{token\}/);
  assert.match(side, /crate::chrome::relink\(shared\)/, "a daemon that restarts is given the sessions again");
  assert.match(rs, /static LINKED/, "kept in the shell's memory only, never written to disk");
  assert.doesNotMatch(rs, /fs::write\([^)]*LINKED|LINKED[^;]*fs::write/);
});
