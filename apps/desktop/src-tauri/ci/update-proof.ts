// The app updating itself, on a real Mac and a real Windows runner (desktop.yml). The installed app is started with a feed of the proof's own (VYRE_UPDATE_FEED, only an address in this
// repository is taken: updater.rs feed_override) that offers the published 1.0.0-rc.16 bundles as a newer version. Their signatures are the release key's own, so nothing here holds a key.
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

const args = process.argv.slice(2);
if (args.length !== 4 || args.some((a) => !a)) { console.error("usage: update-proof.ts <app> <out> <good feed> <bad feed>"); process.exit(2); }
const [APP, OUT, GOOD, BAD] = args as [string, string, string, string];
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
  if (win) { for (const im of ["vyre-desktop.exe", "vyred.exe"]) spawnSync("taskkill", ["/F", "/T", "/IM", im], { stdio: "ignore", timeout: 10_000 }); }
  // by process name: a match on the whole command line would end this script too, whose arguments name the app
  else { spawnSync("pkill", ["-x", "vyre-desktop"], { stdio: "ignore" }); spawnSync("pkill", ["-x", "vyred"], { stdio: "ignore" }); }
}

function launch(feed: string, tag: string, off = false): { child: ChildProcess; log: () => string; waitFor(re: RegExp, ms: number): Promise<boolean> } {
  const env: Record<string, string | undefined> = { ...process.env, VYRE_UPDATE_FEED: feed };
  if (!off) delete env["VYRE_NO_AUTO_UPDATE"];
  const child = spawn(APP, [], { env, stdio: ["ignore", "pipe", "pipe"] });
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
console.log(`update-proof: ${APP}, ${before.length} bytes`);

// 0. the control: the same installed app with automatic updates off opens to its first screen, so a blank page below is the update's doing and not the install's
{
  killAll();
  const run = launch(GOOD, "control", true);
  await run.waitFor(/page rendered: \d+ chars/, 60_000);
  await sleep(4000);
  shot("control");
  const chars = Number(/page rendered: (\d+) chars/.exec(run.log())?.[1] ?? "0");
  console.log(`update-proof: control (updates off) rendered ${chars} chars`);
  if (chars === 0) failures.push("control: the installed app draws nothing even with updates off");
  if (/update: downloading/.test(run.log())) failures.push("control: it updated with VYRE_NO_AUTO_UPDATE=1");
  killAll();
  await sleep(2000);
}

// 1. a bad signature is refused and nothing is installed
{
  killAll();
  const run = launch(BAD, "badsig");
  const refused = await run.waitFor(/update: refused/, 240_000);
  await sleep(3000);
  shot("update-refused");
  if (!refused) failures.push("bad signature: no refusal in the log");
  if (/update: installing/.test(run.log())) failures.push("bad signature: it went on to install");
  if (run.child.exitCode !== null) failures.push("bad signature: the app ended");
  if (!same(APP, before)) failures.push("bad signature: the installed program changed");
  if (!/sidecar ready/.test(run.log())) failures.push("bad signature: the background service was not left running");
  console.log(`update-proof: bad signature refused=${refused}, app running=${run.child.exitCode === null}`);
  killAll();
  await sleep(2000);
}

// 2. the real update, with the daemons stopped first
{
  const run = launch(GOOD, "update");
  const found = await run.waitFor(/update: downloading/, 60_000);
  for (let i = 0; i < 6 && found; i++) { await sleep(1500); shot(`updating-${i}`); }
  const installing = await run.waitFor(/update: installing/, 300_000);
  const order = inOrder(run.log(), [/update: 99\.0\.0-rc\.1 is available/, /update: downloading 99\.0\.0-rc\.1/, /signature verified against the pinned release key/, /update: stopped the device service/, /update: installing 99\.0\.0-rc\.1/]);
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
