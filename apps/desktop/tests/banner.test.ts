// The desktop shell's side of the app's banners and badge (apps/app/src/shell/notifications/os-shell.ts and os-banner.ts): the app calls the shell's `notify` and `set_badge` commands with exactly
// the arguments the Rust commands take, the commands are registered, a banner's link is an `open` link the shell accepts (native.rs open_link_ok, links.rs parse), and the window coming forward opens
// nothing: the notification plugin reports no press on a desktop, so a focus is never read as one (review 12 Nov 2026). What only a real desktop shows (the banner drawn by macOS, Windows or Linux, the system's own permission prompt, the dock or taskbar badge) is not shown here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string): string => readFileSync(new URL(p, import.meta.url), "utf8");
const native = read("../src-tauri/src/native.rs");
const lib = read("../src-tauri/src/lib.rs");
const links = read("../src-tauri/src/links.rs");
const shell = read("../../app/src/shell/notifications/os-shell.ts");
const banner = read("../../app/src/shell/notifications/os-banner.ts");

test("the app calls notify with title, body and link, and set_badge with count: the arguments the Rust commands take", () => {
  assert.match(native, /#\[tauri::command\]\s*pub fn notify\(app: AppHandle, _state: State<'_, AppState>, title: String, body: String, link: String\)/);
  assert.match(shell, /invoke\("notify", \{ title: b\.title, body: b\.body, link: b\.link \}\)/);
  assert.match(native, /#\[tauri::command\]\s*pub fn set_badge\(app: AppHandle, state: State<'_, AppState>, count: u32\)/);
  assert.match(shell, /invoke\("set_badge", \{ count: n \}\)/);
  assert.match(lib, /native::notify,/);
  assert.match(lib, /native::set_badge/);
});

test("a banner's link is an open link the shell accepts, and the window coming forward opens nothing", () => {
  assert.match(banner, /`vyre:\/\/open\?address=\$\{encodeURIComponent\(address\)\}`/, "action open, the Space's address");
  assert.match(native, /pub fn open_link_ok\(link: &str\) -> bool \{\s*links::parse\(link\)\.map_or\(false, \|l\| l\.action == "open"\)/);
  assert.match(links, /pub const ACTIONS: \[&str; \d+\] = \[[^\]]*"open"/);
  assert.doesNotMatch(native, /on_focus|CLICK_WINDOW|commands::deliver/, "no focus is read as a press on a banner");
  assert.doesNotMatch(lib, /native::on_focus/);
  // the keys a banner link carries are plain ones links.rs takes (address, kind, id), never one it refuses
  for (const k of ["address", "kind", "id"]) assert.ok(!new RegExp(`"${k}"`).test(links.match(/matches!\(key\.as_str\(\), ([^)]*)\)/)?.[1] ?? ""), k);
  assert.match(links, /pub const MAX_PARAMS: usize = 16;/);
});

test("a set_badge of 0 clears the dock or taskbar badge", () => {
  assert.match(native, /set_badge_count\(if count > 0 \{ Some\(i64::from\(count\)\) \} else \{ None \}\)/);
});
