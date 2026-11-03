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
if (args.length !== 5 || args.some((a) => !a)) { console.error("usage: update-proof.ts <app to run> <installed program the update replaces> <out> <good feed> <bad feed>"); process.exit(2); }
// On a Mac the two are the same file (the bundle swap replaces the app it runs from). On Windows the NSIS updater installs into the folder VyreSetup.exe installed to, whichever copy of the app
// asked for it; the proof runs the build-folder copy, since the copy VyreSetup.exe /S installs opens a blank page on the hosted runner even with updates off (the control below says so).
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

function launch(feed: string, tag: string, off = false, debugPort = 0): { child: ChildProcess; log: () => string; waitFor(re: RegExp, ms: number): Promise<boolean> } {
  const env: Record<string, string | undefined> = { ...process.env, VYRE_UPDATE_FEED: feed };
  if (!off) delete env["VYRE_NO_AUTO_UPDATE"];
  if (debugPort) env["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = `--remote-debugging-port=${debugPort}`;
  const child = spawn(RUN, [], { env, stdio: ["ignore", "pipe", "pipe"] });
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

/** Windows only: what the page itself says, over WebView2's remote debugging. Reload it with the runtime listening, and report its exceptions, console errors and what it drew. */
async function pageDiagnosis(port: number): Promise<void> {
  try {
    const list = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
    const page = list.find((t) => t.type === "page");
    if (!page) { console.log(`update-proof: diagnosis: no page target (${JSON.stringify(list).slice(0, 300)})`); return; }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((r, j) => { ws.onopen = () => r(); ws.onerror = () => j(new Error("ws")); });
    let id = 0;
    const said: string[] = [];
    const answers = new Map<number, (v: unknown) => void>();
    ws.onmessage = (m) => {
      const msg = JSON.parse(String(m.data)) as { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown };
      if (msg.id !== undefined) { answers.get(msg.id)?.(msg.result); return; }
      if (msg.method === "Runtime.exceptionThrown") said.push(`exception: ${JSON.stringify((msg.params as { exceptionDetails?: unknown }).exceptionDetails).slice(0, 600)}`);
      if (msg.method === "Runtime.consoleAPICalled") { const p = msg.params as { type: string; args: Array<{ value?: unknown; description?: string }> }; if (p.type === "error" || p.type === "warning") said.push(`console.${p.type}: ${p.args.map((a) => a.value ?? a.description).join(" ").slice(0, 400)}`); }
      if (msg.method === "Log.entryAdded") { const e = (msg.params as { entry: { level: string; text: string; url?: string } }).entry; if (e.level === "error") said.push(`log: ${e.text.slice(0, 300)} ${e.url ?? ""}`); }
      if (msg.method === "Network.loadingFailed") said.push(`network failed: ${JSON.stringify(msg.params).slice(0, 300)}`);
    };
    const call = (method: string, params: Record<string, unknown> = {}): Promise<unknown> => new Promise((r) => { const n = ++id; answers.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); setTimeout(() => r(null), 5000); });
    const look = async (when: string): Promise<void> => {
      const r = (await call("Runtime.evaluate", { expression: "JSON.stringify({ href: location.href, text: document.body ? document.body.innerText.length : -1, html: document.documentElement.outerHTML.length, scripts: [...document.scripts].map(s => s.src || 'inline').slice(0, 8), ready: document.readyState, root: !!document.getElementById('root') })", returnByValue: true })) as { result?: { value?: string } } | null;
      console.log(`update-proof: diagnosis ${when}: ${r?.result?.value ?? "no answer"}`);
    };
    await look("before reload");
    await call("Runtime.enable"); await call("Log.enable"); await call("Network.enable");
    await call("Page.reload", { ignoreCache: false });
    await sleep(8000);
    await look("after reload");
    for (const l of said.slice(0, 20)) console.log(`update-proof: diagnosis: ${l}`);
    if (said.length === 0) console.log("update-proof: diagnosis: no exceptions or console errors");
    ws.close();
  } catch (e) { console.log(`update-proof: diagnosis failed: ${String(e)}`); }
}

if (win) {
  const left = spawnSync("tasklist", ["/FI", "IMAGENAME eq msedgewebview2.exe"], { encoding: "utf8" }).stdout ?? "";
  console.log(`update-proof: WebView2 processes left from earlier steps: ${(left.match(/msedgewebview2\.exe/gi) ?? []).length}`);
}
killAll();
await sleep(2000);

// 0. the control: the same installed app with automatic updates off opens to its first screen, so a blank page below is the update's doing and not the install's
{
  killAll();
  const run = launch(GOOD, "control", true, win ? 9339 : 0);
  await run.waitFor(/page rendered: \d+ chars/, 60_000);
  await sleep(4000);
  if (win) await pageDiagnosis(9339);
  shot("control");
  const chars = Number(/page rendered: (\d+) chars/.exec(run.log())?.[1] ?? "0");
  console.log(`update-proof: control (updates off) rendered ${chars} chars`);
  if (chars === 0) failures.push("control: the app draws nothing even with updates off");
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
  if (!/update: the page asked to install/.test(run.log())) failures.push("bad signature: the page never asked to install");
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
