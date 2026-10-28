// Desktop native features (P-L10_04, spec 2.24, 3.13, b13): the notification rules and where a click goes, the tray model, the file pick checks,
// the app's own update channel entry, and the Rust side's shape (read from the files, as shell.test.ts does).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLICK_WINDOW_MS, MAX_BANNERS, activationLink, badgeText, openLink, osNotification, parseOpenLink, pushBanner } from "../src/notify.ts";
import type { Banner, NotificationInput } from "../src/notify.ts";
import { MAX_PICKED, checkPicked, cleanExtension, isAbsolutePath, pickOptions } from "../src/files.ts";
import { trayAction, trayModel } from "../src/tray.ts";
import { ChannelError, MINOR_TOLERANCE, appSupportedByServer, compareVersions, manifestUrl, parseChannelManifest, platformKey, selectAppUpdate } from "../src/channel.ts";
import { makeBridge, shellInvoke, shellListen } from "../src/bridge.ts";
import type { DesktopDeepLink, DesktopInfo } from "../src/bridge.ts";

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TAURI = path.join(DESKTOP, "src-tauri");
const read = (...p: string[]): string => fs.readFileSync(path.join(TAURI, ...p), "utf8");

const note = (o: Partial<NotificationInput> = {}): NotificationInput => ({ key: "approval:7", level: "interrupt", title: "Northwind", body: "Approve the engagement letter", space: "acme.vyre.run", thread: "th_42", at: 1_000_000, ...o });

// ---- notifications -------------------------------------------------------------------------------------------------------------------
test("a notification click deep links to the thread: the banner carries a vyre://open link that parses back to the Space and thread", () => {
  const os = osNotification(note(), { windowFocused: false });
  assert.ok(os);
  assert.equal(os.link, "vyre://open?space=acme.vyre.run&thread=th_42");
  assert.deepEqual(parseOpenLink(os.link), { space: "acme.vyre.run", thread: "th_42" });
  assert.equal(os.tag, "approval:7");
});

test("links survive characters that need escaping and nothing else is accepted as an open link", () => {
  const t = { space: "a b&c.vyre.run", thread: "t/1?x=y#z", record: "r 9" };
  assert.deepEqual(parseOpenLink(openLink(t)), t);
  assert.deepEqual(parseOpenLink("vyre://OPEN/?space=s"), { space: "s" });
  for (const bad of ["", "vyre://join?space=s", "vyre://open", "vyre://open?thread=t", "https://x/open?space=s", "vyre://open?space=%zz", "vyre://open?space=s\n", `vyre://open?space=${"x".repeat(3000)}`, "vyre:open?space=s"]) {
    assert.equal(parseOpenLink(bad), null, JSON.stringify(bad).slice(0, 50));
  }
  assert.equal(parseOpenLink(42 as unknown as string), null);
});

test("a push carries no content: 'Northwind needs you' and an empty body, unless content is switched on", () => {
  const os = osNotification(note(), { windowFocused: false });
  assert.equal(os?.title, "Northwind needs you");
  assert.equal(os?.body, "");
  const shown = osNotification(note(), { windowFocused: false, showContent: true });
  assert.equal(shown?.title, "Northwind");
  assert.equal(shown?.body, "Approve the engagement letter");
});

test("only Interrupt level reaches the operating system, and never while the window is in front", () => {
  assert.equal(osNotification(note({ level: "badge" }), { windowFocused: false }), null);
  assert.equal(osNotification(note({ level: "digest" }), { windowFocused: false }), null);
  assert.equal(osNotification(note(), { windowFocused: true }), null);
  assert.equal(osNotification(note({ key: "" }), { windowFocused: false }), null);
  assert.equal(osNotification(note({ space: "" }), { windowFocused: false }), null);
});

test("control characters are stripped and long text is cut", () => {
  const os = osNotification(note({ title: "A\nB\u0007" + "x".repeat(300), body: "y".repeat(500) }), { windowFocused: false, showContent: true });
  assert.ok(os);
  assert.ok(!/[\u0000-\u001f]/.test(os.title));
  assert.ok(Array.from(os.title).length <= 120);
  assert.ok(Array.from(os.body).length <= 240);
});

test("the same key collapses to one banner (count goes up), newest first, at most three banners", () => {
  let list: Banner[] = [];
  list = pushBanner(list, note({ key: "a", at: 1 }));
  list = pushBanner(list, note({ key: "b", at: 2 }));
  list = pushBanner(list, note({ key: "a", at: 3, body: "newer" }));
  assert.deepEqual(list.map((b) => [b.key, b.count]), [["a", 2], ["b", 1]]);
  assert.equal(list[0].body, "newer");
  list = pushBanner(list, note({ key: "c", at: 4 }));
  list = pushBanner(list, note({ key: "d", at: 5 }));
  assert.equal(list.length, MAX_BANNERS);
  assert.deepEqual(list.map((b) => b.key), ["d", "c", "a"], "the oldest banner drops off");
  assert.deepEqual(pushBanner(list, note({ level: "badge", key: "z" })).map((b) => b.key), ["d", "c", "a"], "a badge-level item never makes a banner");
});

test("a window that comes forward within the click window opens the banner's thread, once", () => {
  const shown = { link: openLink({ space: "s", thread: "t" }), at: 10_000 };
  assert.equal(activationLink(shown, 10_000 + 5_000), shown.link);
  assert.equal(activationLink(shown, 10_000 + CLICK_WINDOW_MS), shown.link);
  assert.equal(activationLink(shown, 10_000 + CLICK_WINDOW_MS + 1), null, "too long after");
  assert.equal(activationLink(shown, 9_999), null, "before the banner is never a click");
  assert.equal(activationLink(null, 10_000), null);
  assert.equal(activationLink({ link: "vyre://join?code=1", at: 10_000 }, 10_001), null, "only open links");
});

test("badge text: none, a number, then 9+", () => {
  assert.deepEqual([0, -3, NaN, 1, 9, 10, 250].map(badgeText), ["", "", "", "1", "9", "9+", "9+"]);
});

// ---- tray ----------------------------------------------------------------------------------------------------------------------------
test("the tray model shows Needs you as the only count, flips Open/Hide with the window, and says whether Vyre is running here", () => {
  const idle = trayModel({ windowVisible: false, needsYou: 0, sidecar: "starting" });
  assert.equal(idle.tooltip, "Vyre");
  assert.equal(idle.badge, "");
  assert.deepEqual(idle.items.map((i) => i.id), ["open", "needs", "sep", "status", "quit"]);
  assert.equal(idle.items[0].label, "Open Vyre");
  assert.equal(idle.items[1].enabled, false);
  assert.match(idle.items[3].label, /Starting/);
  const busy = trayModel({ windowVisible: true, needsYou: 12, sidecar: "ready", version: "1.2.3" });
  assert.equal(busy.items[0].label, "Hide Vyre");
  assert.equal(busy.items[1].label, "Needs you (12)");
  assert.equal(busy.items[1].enabled, true);
  assert.equal(busy.badge, "9+");
  assert.equal(busy.tooltip, "Vyre, 12 things need you");
  assert.equal(trayModel({ windowVisible: true, needsYou: 1, sidecar: "failed" }).tooltip, "Vyre, 1 thing needs you");
  assert.match(busy.items[3].label, /Running \(1\.2\.3\)/);
  assert.match(trayModel({ windowVisible: true, needsYou: 0, sidecar: "failed" }).items[3].label, /Not running/);
});

test("tray clicks: Open toggles, Needs you opens that place, Quit quits, the rest do nothing", () => {
  assert.deepEqual(["open", "needs", "quit", "status", "sep", "other"].map(trayAction), ["toggle", "needs-you", "quit", "none", "none", "none"]);
});

// ---- file pick -----------------------------------------------------------------------------------------------------------------------
test("pick options: a folder pick has no filters, extensions are cleaned, and one file means no multiple", () => {
  const folder = pickOptions({ kind: "folder", accept: { Docs: ["pdf"] } });
  assert.deepEqual([folder.directory, folder.multiple, folder.filters.length, folder.title], [true, false, 0, "Choose a folder"]);
  const files = pickOptions({ kind: "files", accept: { Documents: ["PDF", "*.docx", ".md", "bad ext", "x/y"], Empty: ["???"] } });
  assert.equal(files.multiple, true);
  assert.deepEqual(files.filters, [{ name: "Documents", extensions: ["pdf", "docx", "md"] }]);
  const one = pickOptions({ kind: "file", title: "Pick the signed copy" });
  assert.deepEqual([one.multiple, one.directory, one.title], [false, false, "Pick the signed copy"]);
  assert.equal(pickOptions({ kind: "file", startIn: "/Users/a/Documents" }).startIn, "/Users/a/Documents");
  assert.equal(pickOptions({ kind: "file", startIn: "../etc" }).startIn, undefined);
  assert.equal(cleanExtension("*.TXT"), "txt");
  assert.equal(cleanExtension("a.b"), null);
});

test("what comes back from the dialog: absolute paths only, no '..', no duplicates, capped, one when one was asked for", () => {
  assert.ok(isAbsolutePath("/Users/a/x.pdf") && isAbsolutePath("C:\\Users\\a\\x.pdf") && isAbsolutePath("\\\\server\\share\\x"));
  for (const bad of ["x.pdf", "./x", "/a/../b", "C:\\a\\..\\b", "", "/a\nb"]) assert.equal(isAbsolutePath(bad), false, JSON.stringify(bad));
  assert.deepEqual(checkPicked({ multiple: true }, ["/a", "rel", "/a", "/b/../c", "/d"]), ["/a", "/d"]);
  assert.deepEqual(checkPicked({ multiple: false }, ["/a", "/b"]), ["/a"]);
  assert.deepEqual(checkPicked({ multiple: true }, null), []);
  assert.equal(checkPicked({ multiple: true }, Array.from({ length: MAX_PICKED + 50 }, (_, i) => `/f/${i}`)).length, MAX_PICKED);
});

// ---- the page's bridge ---------------------------------------------------------------------------------------------------------------
test("the bridge sends only what the rules allow and checks what comes back", async () => {
  const calls: { c: string; a?: Record<string, unknown> }[] = [];
  const answers: Record<string, unknown> = { pick_paths: ["/ok/a.pdf", "relative.pdf", "/ok/a.pdf"] };
  const b = makeBridge(async (c, a) => { calls.push({ c, a }); return answers[c]; }, async () => () => {});
  assert.equal(await b.notify(note({ level: "badge" }), { windowFocused: false }), false);
  assert.equal(calls.length, 0, "a badge-level item never calls the shell");
  assert.equal(await b.notify(note(), { windowFocused: true }), false);
  assert.equal(await b.notify(note(), { windowFocused: false }), true);
  assert.deepEqual(calls[0], { c: "notify", a: { title: "Northwind needs you", body: "", link: "vyre://open?space=acme.vyre.run&thread=th_42", tag: "approval:7" } });
  assert.deepEqual(await b.pick({ kind: "files", accept: { PDF: ["pdf"] } }), ["/ok/a.pdf"]);
  assert.equal((calls[1].a?.["options"] as { multiple: boolean }).multiple, true);
  answers["pick_paths"] = "not a list";
  assert.deepEqual(await b.pick({ kind: "file" }), []);
  await b.setBadge(7.9);
  assert.deepEqual(calls[calls.length - 1], { c: "set_badge", a: { count: 7, text: "7" } });
  await b.setBadge(-4);
  assert.deepEqual(calls[calls.length - 1], { c: "set_badge", a: { count: 0, text: "" } });
  assert.equal(shellInvoke({}), undefined, "in a browser there is no shell");
  const fn = async (): Promise<unknown> => 1;
  assert.equal(shellInvoke({ __TAURI__: { core: { invoke: fn } } }), fn);
  const listen = async (): Promise<() => void> => () => {};
  assert.equal(shellListen({ __TAURI__: { event: { listen } } }), listen);
});

test("desktop bootstrap returns only typed shell status and the one pending Vyre deep link", async () => {
  const calls: string[] = [];
  const info: DesktopInfo = {
    app: "vyre-desktop", version: "1.0.0-rc.1", platform: "macos", arch: "aarch64",
    sidecar: { phase: "ready", url: "http://127.0.0.1:41233", version: "1.0.0-rc.1", restarts: 0, error: null },
  };
  const pending: DesktopDeepLink = { action: "join", params: { address: "https://acme.vyre.run", code: "one-time-code", fp: "abcd" } };
  const bridge = makeBridge(async (command) => {
    calls.push(command);
    return command === "desktop_info" ? info : command === "take_pending_link" ? pending : undefined;
  }, async () => () => {});

  assert.deepEqual(await bridge.bootstrap(), { info, pendingLink: pending });
  assert.deepEqual(calls, ["desktop_info", "take_pending_link"]);
});

test("desktop link handoff is ordered, bounded, replaceable, and stays subscribed between callbacks", async () => {
  const nativeListeners = new Set<(event: { payload: unknown }) => void>();
  const nativeEvents: string[] = [];
  let nativeSubscriptions = 0;
  let nativeUnsubscribes = 0;
  const emit = (link: DesktopDeepLink): void => {
    for (const listener of nativeListeners) listener({ payload: link });
  };
  const info: DesktopInfo = {
    app: "vyre-desktop", version: "1.0.0-rc.1", platform: "macos", arch: "aarch64",
    sidecar: { phase: "ready", url: "http://127.0.0.1:41233", version: "1.0.0-rc.1", restarts: 0, error: null },
  };
  const bridge = makeBridge(async (command) => {
    if (command === "desktop_info") return info;
    if (command === "take_pending_link") {
      for (let i = 0; i < 17; i++) emit({ action: "join", params: { code: String(i) } });
      return null;
    }
    return undefined;
  }, async (event, listener) => {
    nativeSubscriptions++;
    nativeEvents.push(event);
    nativeListeners.add(listener);
    return () => {
      nativeUnsubscribes++;
      nativeListeners.delete(listener);
    };
  });

  assert.deepEqual(await bridge.bootstrap(), { info, pendingLink: null });
  const first: DesktopDeepLink[] = [];
  const unlistenA = await bridge.listenLinks((delivered) => first.push(delivered));
  assert.deepEqual(first.map((link) => link.params["code"]), Array.from({ length: 16 }, (_, i) => String(i + 1)));

  emit({ action: "open", params: { address: "https://first.vyre.run" } });
  unlistenA();
  emit({ action: "open", params: { address: "https://gap.vyre.run" } });

  const second: DesktopDeepLink[] = [];
  const unlistenB = await bridge.listenLinks((delivered) => second.push(delivered));
  emit({ action: "open", params: { address: "https://second.vyre.run" } });

  const third: DesktopDeepLink[] = [];
  const unlistenC = await bridge.listenLinks((delivered) => third.push(delivered));
  emit({ action: "open", params: { address: "https://third.vyre.run" } });
  unlistenB();
  emit({ action: "open", params: { address: "https://still-third.vyre.run" } });

  assert.deepEqual(first.filter((link) => link.action === "open").map((link) => link.params["address"]), ["https://first.vyre.run"]);
  assert.deepEqual(second.map((link) => link.params["address"]), ["https://gap.vyre.run", "https://second.vyre.run"]);
  assert.deepEqual(third.map((link) => link.params["address"]), ["https://third.vyre.run", "https://still-third.vyre.run"]);
  assert.equal(nativeSubscriptions, 1);
  assert.equal(nativeUnsubscribes, 0);
  assert.deepEqual(nativeEvents, ["vyre://deep-link"]);
  unlistenC();
  assert.equal(nativeUnsubscribes, 0);
});

test("desktop link delivery refuses control characters in decoded parameters", async () => {
  const received: DesktopDeepLink[] = [];
  const bridge = makeBridge(async () => undefined, async (_event, listener) => {
    listener({ payload: { action: "join", params: { code: "safe" } } });
    listener({ payload: { action: "join", params: { code: "bad\ncode" } } });
    listener({ payload: { action: "delete", params: { code: "safe" } } });
    return () => {};
  });

  await bridge.listenLinks((link) => received.push(link));

  assert.deepEqual(received, [{ action: "join", params: { code: "safe" } }]);
});

// ---- the app's update channel --------------------------------------------------------------------------------------------------------
const sha = "a".repeat(64);
const manifest = (over: Record<string, unknown> = {}): string => JSON.stringify({
  v: 1, channel: "stable",
  app: { version: "1.4.0", notes: "Faster start", pubDate: "2026-10-25T00:00:00Z", platforms: {
    "darwin-aarch64": { url: "https://vyre.run/app/1.4.0/Vyre_1.4.0_aarch64.dmg", sha256: sha, kind: "dmg", size: 90_000_000 },
    "windows-x86_64": { url: "https://vyre.run/app/1.4.0/Vyre_1.4.0_x64-setup.exe", sha256: sha, kind: "nsis" },
  } },
  server: { version: "1.4.1" }, ...over,
});

test("the update channel entry is parsed: app version, per-platform artifacts, and the server's version beside it", () => {
  const m = parseChannelManifest(manifest());
  assert.equal(m.channel, "stable");
  assert.equal(m.app?.version, "1.4.0");
  assert.deepEqual(Object.keys(m.app?.platforms ?? {}).sort(), ["darwin-aarch64", "windows-x86_64"]);
  assert.equal(m.app?.platforms["darwin-aarch64"]?.kind, "dmg");
  assert.equal(m.app?.platforms["darwin-aarch64"]?.size, 90_000_000);
  assert.equal(m.server?.version, "1.4.1");
});

test("the app channel is independent of the server's: either part may be missing", () => {
  const appOnly = parseChannelManifest(JSON.stringify({ v: 1, channel: "beta", app: { version: "1.5.0-beta.1", platforms: {} } }));
  assert.equal(appOnly.server, undefined);
  const serverOnly = parseChannelManifest(JSON.stringify({ v: 1, channel: "stable", server: { version: "1.4.1" } }));
  assert.equal(serverOnly.app, undefined);
  assert.equal(selectAppUpdate(serverOnly, { platform: "darwin-aarch64", current: "1.0.0" }), null, "a manifest without an app part offers nothing");
});

test("a manifest the app cannot trust is refused, with the reason", () => {
  const bad = (m: unknown, re: RegExp): void => assert.throws(() => parseChannelManifest(typeof m === "string" ? m : JSON.stringify(m)), (e: unknown) => e instanceof ChannelError && re.test(e.message));
  bad("not json", /not JSON/);
  bad("[]", /not an object/);
  bad({ v: 2, channel: "stable" }, /unknown manifest version/);
  bad({ v: 1, channel: "weekly" }, /channel must be/);
  bad({ v: 1, channel: "stable", app: { version: "latest", platforms: {} } }, /not a version/);
  const plat = (p: Record<string, unknown>) => ({ v: 1, channel: "stable", app: { version: "1.0.0", platforms: p } });
  bad(plat({ "darwin-aarch64": { url: "http://vyre.run/x.dmg", sha256: sha, kind: "dmg" } }), /https/);
  bad(plat({ "darwin-aarch64": { url: "https://vyre.run/x.dmg", sha256: "ABC", kind: "dmg" } }), /sha256/);
  bad(plat({ "darwin-aarch64": { url: "https://vyre.run/x.dmg", sha256: sha, kind: "exe" } }), /kind/);
  bad(plat({ "darwin-aarch64": { url: "https://vyre.run/x.dmg", sha256: sha, kind: "dmg", size: -1 } }), /size/);
  bad(plat({ "plan9-mips": { url: "https://vyre.run/x", sha256: sha, kind: "dmg" } }), /unknown platform/);
  bad({ v: 1, channel: "stable", server: { version: "x" } }, /server.version/);
  assert.throws(() => parseChannelManifest(" ".repeat(300 * 1024)), /too large/);
});

test("version order is semver: prereleases sort before their release and beta.10 is after beta.9", () => {
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
  assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareVersions("1.0.0-beta.2", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0-beta.10", "1.0.0-beta.9"), 1);
  assert.equal(compareVersions("1.0.0-alpha", "1.0.0-beta"), -1);
  assert.throws(() => compareVersions("1.0", "1.0.0"), ChannelError);
});

test("platform keys come from the shell's OS and architecture names", () => {
  assert.equal(platformKey("macos", "aarch64"), "darwin-aarch64");
  assert.equal(platformKey("macos", "x86_64"), "darwin-x86_64");
  assert.equal(platformKey("windows", "x86_64"), "windows-x86_64");
  assert.equal(platformKey("linux", "arm64"), "linux-aarch64");
  assert.equal(platformKey("freebsd", "x86_64"), null);
});

test("an update is offered only when it is newer, has this platform's artifact, and the connected servers can use it", () => {
  const m = parseChannelManifest(manifest());
  const q = { platform: "darwin-aarch64" as const, current: "1.3.2" };
  const pick = selectAppUpdate(m, q);
  assert.equal(pick?.version, "1.4.0");
  assert.equal(pick?.artifact.kind, "dmg");
  assert.equal(pick?.notes, "Faster start");
  assert.equal(selectAppUpdate(m, { ...q, current: "1.4.0" }), null, "same version");
  assert.equal(selectAppUpdate(m, { ...q, current: "1.5.0" }), null, "already ahead");
  assert.equal(selectAppUpdate(m, { ...q, platform: "linux-x86_64" }), null, "no artifact for this platform yet (staggered release)");
  assert.equal(selectAppUpdate(m, { ...q, servers: ["1.4.1", "1.3.0"] })?.version, "1.4.0");
  assert.equal(selectAppUpdate(m, { ...q, servers: ["1.1.0"] }), null, "a server more than two minors behind would not work with it");
});

test("a server and an app tolerate each other within two minor versions of the same major", () => {
  assert.equal(MINOR_TOLERANCE, 2);
  assert.equal(appSupportedByServer("1.4.0", "1.2.9"), true);
  assert.equal(appSupportedByServer("1.4.0", "1.6.0"), true);
  assert.equal(appSupportedByServer("1.4.0", "1.7.0"), false);
  assert.equal(appSupportedByServer("1.4.0", "1.1.0"), false);
  assert.equal(appSupportedByServer("2.0.0", "1.9.0"), false);
  assert.equal(appSupportedByServer("x", "1.0.0"), false);
});

test("the channel's address is https and in its own folder", () => {
  assert.equal(manifestUrl("https://vyre.run/app/", "beta"), "https://vyre.run/app/beta.json");
  assert.throws(() => manifestUrl("http://vyre.run/app", "stable"), ChannelError);
});

// ---- the Rust side and the Windows installer ------------------------------------------------------------------------------------------
test("the shell registers the tray, notification and dialog plugins and exposes exactly the native commands the bridge calls", () => {
  const lib = read("src", "lib.rs");
  const native = read("src", "native.rs");
  assert.match(lib, /tauri_plugin_notification::init\(\)/);
  assert.match(lib, /tauri_plugin_dialog::init\(\)/);
  assert.match(lib, /native::notify,\s*native::discover_codex_sessions,\s*native::discover_session_sources,\s*native::read_session_source,\s*native::pick_paths,\s*native::set_badge/);
  assert.match(lib, /WindowEvent::Focused\(true\)[\s\S]*native::on_focus/);
  assert.match(lib, /native::setup_tray/);
  for (const fn of ["notify", "discover_codex_sessions", "discover_session_sources", "pick_paths", "set_badge"]) assert.match(native, new RegExp(`#\\[tauri::command\\]\\s*pub (async )?fn ${fn}\\(`), fn);
  const bridge = fs.readFileSync(path.join(DESKTOP, "src", "bridge.ts"), "utf8");
  for (const c of ["notify", "discover_codex_sessions", "discover_session_sources", "pick_paths", "set_badge"]) assert.ok(bridge.includes(`"${c}"`), `the bridge calls ${c}`);
  assert.match(read("Cargo.toml"), /tauri = \{ version = "2", features = \["tray-icon"\] \}/);
});

test("the Rust side agrees with the TypeScript rules: click window, banner links, text caps, and no notification text in a log", () => {
  const native = read("src", "native.rs");
  assert.match(native, new RegExp(`CLICK_WINDOW: Duration = Duration::from_secs\\(${CLICK_WINDOW_MS / 1000}\\)`));
  assert.match(native, /MAX_TITLE: usize = 120/);
  assert.match(native, /MAX_BODY: usize = 240/);
  assert.match(native, /l\.action == "open"/, "only open links ride on a banner");
  assert.match(native, /commands::deliver\(app, link\)/, "the click goes through the same delivery as any deep link");
  assert.doesNotMatch(native, /println!\([^)]*(title|body|link)/, "banner text and links never reach a log");
  assert.match(native, /fn setup_tray/);
  assert.match(native, /"quit" => app\.exit\(0\)/);
  assert.match(native, /show_menu_on_left_click\(false\)/);
});

test("the page gets no new native power through capabilities: the plugins are used by our own commands only", () => {
  const caps = JSON.parse(read("capabilities", "default.json")) as { permissions: string[] };
  assert.ok(!caps.permissions.some((p) => p.startsWith("notification:") || p.startsWith("dialog:") || p.startsWith("fs:")), caps.permissions.join(","));
});

test("Windows ships an NSIS installer that installs for the current user and fetches WebView2 when it is missing; Mac and Linux bundles stay", () => {
  const c = JSON.parse(read("tauri.conf.json")) as { bundle: { targets: string[]; windows: { nsis: { installMode: string }; webviewInstallMode: { type: string } } } };
  assert.ok(c.bundle.targets.includes("nsis"));
  assert.equal(c.bundle.windows.nsis.installMode, "currentUser");
  assert.equal(c.bundle.windows.webviewInstallMode.type, "downloadBootstrapper");
  for (const t of ["app", "dmg", "deb", "appimage"]) assert.ok(c.bundle.targets.includes(t), t);
  assert.match(fs.readFileSync(path.join(DESKTOP, "package.json"), "utf8"), /"build:win": ".*--bundles nsis"/);
});

test("only erasable TypeScript in the desktop sources: no enums, no @ts-nocheck, no node or browser imports", () => {
  for (const f of ["notify.ts", "files.ts", "tray.ts", "channel.ts", "bridge.ts"]) {
    const s = fs.readFileSync(path.join(DESKTOP, "src", f), "utf8");
    assert.doesNotMatch(s, /@ts-nocheck|@ts-ignore/, f);
    assert.doesNotMatch(s, /^\s*(export )?(const )?enum /m, f);
    assert.doesNotMatch(s, /from "node:|require\(/, f);
    assert.doesNotMatch(s, /constructor\([^)]*(public|private|readonly) /, f);
  }
});
