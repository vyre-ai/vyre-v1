// The app updating itself, on a real Mac and a real Windows runner (desktop.yml). The installed app is started with a feed of the proof's own (VYRE_UPDATE_FEED, only an address in this
// repository is taken: updater.rs feed_override) that offers the published 1.0.0-rc.18 bundles as a newer version. Their signatures are the release key's own, so nothing here holds a key.
//
//   1. bad signature: each bundle carries the other platform's signature. The app downloads it, refuses it, installs nothing, keeps running, and the page says so in one line.
//   2. the real update: the page sees a newer version with "Update Vyre automatically" on (the default) and installs on start. The log must show, in order: the version found, the download,
//      the signature checked, every running daemon stopped (its process gone), the install. The installed program is then a different file, and the new app opens.
// Screenshots of the Updating screen on the real system go to <out>.
//   node update-proof.ts <installed app executable> <out dir> <good feed url> <bad feed url>
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
// --day-two <app> <out>: the shipped app (rc.18) opened twice on this profile, so the second start shows what a person saw before this fix; its blank second start is recorded, not asserted.
const dayTwo = argv[0] === "--day-two";
// --kept-profile: the profile is the one --day-two left (an earlier version's service worker in it), and the first start must remove that worker and draw.
const kept = argv[0] === "--kept-profile";
const args = dayTwo ? [argv[1] ?? "", argv[1] ?? "", argv[2] ?? "", "-", "-"] : kept ? argv.slice(1) : argv;
if (args.length !== 5 || args.some((a) => !a)) { console.error("usage: update-proof.ts <app to run> <installed program the update replaces> <out> <good feed> <bad feed>"); process.exit(2); }
// desktop.yml passes the same file twice: the installed app is both what runs and what the update replaces (the Mac bundle swap, or the NSIS updater on Windows).
const [RUN, APP, OUT, GOOD, BAD] = args as [string, string, string, string, string];
fs.mkdirSync(OUT, { recursive: true });
const win = process.platform === "win32";
/** The program as it is now; a different program after the update. */
const bytesOf = (f: string): Buffer => fs.readFileSync(f);
const same = (f: string, b: Buffer): boolean => bytesOf(f).equals(b);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function shot(name: string): void {
  const file = path.join(OUT, `${process.platform}-${name}.png`);
  if (win) spawnSync("powershell", ["-NoProfile", "-Command", `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.SystemInformation]::VirtualScreen; $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size); $bmp.Save('${file}')`], { stdio: "ignore", timeout: 20_000 });
  else spawnSync("screencapture", ["-x", file], { stdio: "ignore", timeout: 20_000 });
}

function killAll(): void {
  // WebView2's own processes too: one left from an earlier step that killed the app without its tree keeps the profile, and every later window attaches to it and draws nothing
  if (win) { for (const im of ["vyre-desktop.exe", "vyred.exe", "msedgewebview2.exe"]) spawnSync("taskkill", ["/F", "/T", "/IM", im], { stdio: "ignore", timeout: 10_000 }); }
  // by process name: a match on the whole command line would end this script too, whose arguments name the app
  else { spawnSync("pkill", ["-x", "vyre-desktop"], { stdio: "ignore" }); spawnSync("pkill", ["-x", "vyred"], { stdio: "ignore" }); }
}

/** Close the app the way a person does (its window's close, or Quit on a Mac) and wait for it to end; force it only if it has not ended in 15 s. A force kill is what an earlier step's trap does,
 *  and the start after one is what the force-kill check below looks at, so a normal close is the default between launches here. */
async function quit(tag: string): Promise<void> {
  const running = (): boolean => (win
    ? /vyre-desktop\.exe/i.test(spawnSync("tasklist", ["/FI", "IMAGENAME eq vyre-desktop.exe"], { encoding: "utf8" }).stdout ?? "")
    : spawnSync("pgrep", ["-x", "vyre-desktop"], { stdio: "ignore" }).status === 0);
  if (win) spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", "Get-Process vyre-desktop -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { [void]$_.CloseMainWindow() }"], { stdio: "ignore", timeout: 20_000 });
  else spawnSync("osascript", ["-e", 'tell application id "ai.vyre.desktop" to quit'], { stdio: "ignore", timeout: 20_000 });
  for (let i = 0; i < 60 && running(); i++) await sleep(250);
  const forced = running();
  if (forced) killAll();
  await sleep(1500);
  if (win) spawnSync("taskkill", ["/F", "/T", "/IM", "vyred.exe"], { stdio: "ignore", timeout: 10_000 });
  console.log(`update-proof: ${tag}: closed ${forced ? "by force (it did not end in 15 s)" : "normally"}`);
}

/** Windows: the app's two folders (the WebView2 profile and the daemons' data), so a run starts as a fresh person and the artifact shows what an earlier run left. */
const PROFILE = win ? [path.join(process.env["LOCALAPPDATA"] ?? "", "ai.vyre.desktop"), path.join(process.env["APPDATA"] ?? "", "ai.vyre.desktop")] : [];
function profileListing(tag: string): void {
  const lines: string[] = [];
  const walk = (d: string, depth: number): void => {
    let names: string[] = [];
    try { names = fs.readdirSync(d); } catch { return; }
    for (const n of names.sort()) { const f = path.join(d, n); lines.push(`${"  ".repeat(depth)}${n}`); if (depth < 3) { try { if (fs.statSync(f).isDirectory()) walk(f, depth + 1); } catch { /* gone */ } } }
  };
  for (const d of PROFILE) { lines.push(`${d}${fs.existsSync(d) ? "" : " (none)"}`); walk(d, 1); }
  fs.writeFileSync(path.join(OUT, `${process.platform}-profile-${tag}.txt`), `${lines.join("\n")}\n`);
}
function freshProfile(tag: string): void {
  profileListing(tag);
  for (const d of PROFILE) fs.rmSync(d, { recursive: true, force: true });
}
const charsOf = (log: string): number => Number(/page rendered: (\d+) chars/.exec(log)?.[1] ?? "0");

function launch(feed: string, tag: string, off = false): { child: ChildProcess; log: () => string; waitFor(re: RegExp, ms: number): Promise<boolean> } {
  const env: Record<string, string | undefined> = { ...process.env, VYRE_UPDATE_FEED: feed };
  if (!off) delete env["VYRE_NO_AUTO_UPDATE"];
  // the default stdio, as apps/desktop/tests/shell.heavy.test.ts starts it: started with stdin "ignore" the Windows app's page draws nothing (tmp-winlook run 41596151473, where the
  // same installed rc.18 opened from Explorer draws its Welcome screen)
  const child = spawn(RUN, [], { env });
  let text = "";
  const file = path.join(OUT, `${process.platform}-${tag}.log`);
  const add = (c: Buffer): void => { const s = c.toString("utf8"); text += s; fs.appendFileSync(file, s); };
  child.stdout!.on("data", add);
  child.stderr!.on("data", add);
  return {
    child, log: () => text,
    async waitFor(re, ms) { const end = Date.now() + ms; while (Date.now() < end) { if (re.test(text)) return true; await sleep(250); } return re.test(text); },
  };
}

function inOrder(log: string, steps: readonly RegExp[]): string | null {
  let at = 0;
  for (const re of steps) {
    const m = re.exec(log.slice(at));
    if (!m) return `missing, or out of order: ${re}`;
    at += m.index + m[0].length;
  }
  return null;
}

const failures: string[] = [];
const before = bytesOf(APP);
console.log(`update-proof: runs ${RUN}; the update must replace ${APP} (${before.length} bytes)`);

if (win) {
  const left = spawnSync("tasklist", ["/FI", "IMAGENAME eq msedgewebview2.exe"], { encoding: "utf8" }).stdout ?? "";
  console.log(`update-proof: WebView2 processes left from earlier steps: ${(left.match(/msedgewebview2\.exe/gi) ?? []).length}`);
}
killAll();
await sleep(2000);
if (dayTwo) {
  freshProfile("before-day-two");
  for (const n of [1, 2]) {
    const run = launch("-", `shipped-start-${n}`, true);
    await run.waitFor(/page rendered: \d+ chars/, 60_000);
    await sleep(6000);
    shot(`shipped-start-${n}`);
    console.log(`update-proof: the shipped app, start ${n} on this profile: ${charsOf(run.log())} chars`);
    await quit(`shipped-start-${n}`);
  }
  profileListing("after-day-two");
  process.exit(0);
}
if (kept) {
  // the shipped app's worker is in this profile: the first start of this build removes it and draws
  profileListing("kept");
  const run = launch(GOOD, "upgraded-start", true);
  const removed = await run.waitFor(/page serviceworker: removed \d+ service worker/, 60_000);
  await run.waitFor(/page rendered: [1-9]\d* chars/, 30_000);
  await sleep(4000);
  shot("upgraded-start");
  const after = charsOf(run.log().split("page serviceworker")[1] ?? "");
  console.log(`update-proof: first start over the shipped app's profile: worker removed=${removed}, then ${after} chars`);
  if (!removed) failures.push("upgrade: the earlier version's service worker was not removed");
  if (after === 0) failures.push("upgrade: the app draws nothing after removing the earlier worker");
  await quit("upgraded-start");
} else {
  // the earlier steps of this job ran the app on this profile and ended it with a force kill (run-shell.sh's trap): start as a fresh person, keeping a listing of what was there
  freshProfile("before");
}

// 0. the control: the same installed app with automatic updates off opens to its first screen, so a blank page below is the update's doing and not the install's.
//    Then, on record: it opens again after a normal close, and what it does after a force kill (the earlier blank pages came right after one).
{
  const run = launch(GOOD, "control", true);
  await run.waitFor(/page rendered: \d+ chars/, 60_000);
  await sleep(4000);
  shot("control");
  const chars = charsOf(run.log());
  console.log(`update-proof: control (updates off) rendered ${chars} chars`);
  if (chars === 0) failures.push("control: the app draws nothing even with updates off");
  if (/update: downloading/.test(run.log())) failures.push("control: it updated with VYRE_NO_AUTO_UPDATE=1");
  await quit("control");
  const again = launch(GOOD, "control-again", true);
  await again.waitFor(/page rendered: \d+ chars/, 60_000);
  await sleep(4000);
  shot("control-again");
  console.log(`update-proof: control after a normal close rendered ${charsOf(again.log())} chars`);
  if (charsOf(again.log()) === 0) failures.push("control: the app draws nothing the second time it opens, after a normal close");
  killAll();
  await sleep(2000);
  profileListing("after-force-kill");
  const forced = launch(GOOD, "control-after-kill", true);
  await forced.waitFor(/page rendered: \d+ chars/, 60_000);
  await sleep(4000);
  shot("control-after-kill");
  const afterKill = charsOf(forced.log());
  console.log(`update-proof: after a force kill the app rendered ${afterKill} chars on its next start`);
  if (afterKill === 0) failures.push("control: after a force kill (a crash) the app draws nothing on its next start");
  await quit("control-after-kill");
  profileListing("after-control");
}

// 1. a bad signature is refused and nothing is installed
{
  const run = launch(BAD, "badsig");
  const refused = await run.waitFor(/update: refused/, 240_000);
  await sleep(3000);
  shot("update-refused");
  if (!refused) failures.push("bad signature: no refusal in the log");
  if (!/update: the page asked to install/.test(run.log())) failures.push("bad signature: the page never asked to install");
  if (/update: installing/.test(run.log())) failures.push("bad signature: it went on to install");
  if (run.child.exitCode !== null) failures.push("bad signature: the app ended");
  if (!same(APP, before)) failures.push("bad signature: the installed program changed");
  if (!/sidecar ready/.test(run.log())) failures.push("bad signature: the background service was not left running");
  console.log(`update-proof: bad signature refused=${refused}, app running=${run.child.exitCode === null}`);
  await quit("badsig");
}

// 2. the real update, with the daemons stopped first
{
  const run = launch(GOOD, "update");
  const found = await run.waitFor(/update: downloading/, 60_000);
  for (let i = 0; i < 6 && found; i++) { await sleep(1500); shot(`updating-${i}`); }
  const installing = await run.waitFor(/update: installing/, 300_000);
  const order = inOrder(run.log(), [/update: 99\.0\.0-rc\.1 is available/, /update: the page asked before the lock screen: Available 99\.0\.0-rc\.1/, /update: the page asked to install/, /update: downloading 99\.0\.0-rc\.1/, /signature verified against the pinned release key/, /update: stopped the device service/, /update: installing 99\.0\.0-rc\.1/]);
  if (inOrder(run.log(), [/sidecar ready/, /update: stopped the device service/])) failures.push("update: the device service was not running before the update stopped it");
  if (!installing) failures.push("update: it never reached the install");
  if (order) failures.push(`update: ${order}`);
  // the installer (Windows) or the bundle swap and restart (Mac) replaces the program; then the new app opens
  let changed = false;
  for (let i = 0; i < 120 && !changed; i++) { await sleep(2500); try { changed = !same(APP, before); } catch { /* the installer is writing it */ } }
  if (!changed) failures.push("update: the installed program is the same file after the update");
  await sleep(15_000);
  shot("after-update");
  const running = win
    ? /vyre-desktop\.exe/i.test(spawnSync("tasklist", ["/FI", "IMAGENAME eq vyre-desktop.exe"], { encoding: "utf8" }).stdout ?? "")
    : spawnSync("pgrep", ["-x", "vyre-desktop"], { encoding: "utf8" }).status === 0;
  if (!running) failures.push("update: the new app did not open");
  console.log(`update-proof: installed ${changed ? "a different program" : "nothing new"}, new app running=${running}`);
  console.log(run.log().split("\n").filter((l) => l.includes("vyre-desktop: update:")).join("\n"));
  killAll();
}

if (failures.length > 0) { for (const f of failures) console.error(`update-proof: FAIL ${f}`); process.exit(1); }
console.log("update-proof: ok");
process.exit(0);
