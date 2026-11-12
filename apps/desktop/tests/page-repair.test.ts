// The scripts the shell runs in its page after every load (lib.rs), run here against a stand-in window: an earlier version's service worker is removed with its caches, and the page loads
// again only when that worker served it, at most as often as the shell allows; and a window that has drawn nothing a few seconds after loading says what it shows and recovers by itself.
// Update proof run 43109353813 (Windows): the removal ran twice on one start because the page loaded again even when the app had served it itself.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const LIB = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "src", "lib.rs"), "utf8");
function script(name: string): string {
  const m = new RegExp(`const ${name}: &str = r#"([\\s\\S]*?)"#;`).exec(LIB);
  assert.ok(m, `${name} is in lib.rs`);
  return m[1]!;
}

type Call = { cmd: string; args: Record<string, string> };
type El = { tag: string; textContent: string; style: Record<string, string>; attrs: Record<string, string>; kids: El[]; clicks: (() => void)[]; setAttribute(k: string, v: string): void; appendChild(c: El): void; addEventListener(e: string, fn: () => void): void };
type Page = {
  calls: Call[]; replaced: string[]; unregistered: number; deleted: string[]; shown: El[];
  run(src: string): void; advance(ms: number): Promise<void>; settle(): Promise<void>;
};

/** A stand-in for the WebView's page: workers (and whether one controls this page), caches, the body's text, and the shell's commands. `allow` is the shell's answer to page_recover. */
function page(o: { workers?: number; controlled?: boolean; text?: string; allow?: boolean; caches?: string[] }): Page {
  const p = { calls: [] as Call[], replaced: [] as string[], unregistered: 0, deleted: [] as string[], shown: [] as El[] } as Page;
  let now = 0;
  const timers: { at: number; fn: () => void }[] = [];
  const regs = Array.from({ length: o.workers ?? 0 }, () => ({ unregister: () => { p.unregistered++; return Promise.resolve(true); } }));
  const keys = o.caches ?? [];
  const win: Record<string, unknown> = {
    __TAURI__: { core: { invoke: (cmd: string, args: Record<string, string>) => { p.calls.push({ cmd, args }); return Promise.resolve(cmd === "page_recover" ? o.allow ?? true : null); } } },
    addEventListener() {},
    setTimeout: (fn: () => void, ms: number) => { timers.push({ at: now + ms, fn }); return timers.length; },
    navigator: { serviceWorker: { controller: o.controlled ? { scriptURL: "http://tauri.localhost/sw.js" } : null, getRegistrations: () => Promise.resolve(regs) } },
    caches: { keys: () => Promise.resolve(keys), delete: (k: string) => { p.deleted.push(k); return Promise.resolve(true); } },
    location: { protocol: "http:", host: "tauri.localhost", pathname: "/", href: "http://tauri.localhost/", replace: (u: string) => { p.replaced.push(u); } },
    document: {
      readyState: "complete", title: "Vyre", documentElement: { outerHTML: "<html><body><div id=root></div></body></html>" },
      body: { innerText: o.text ?? "", children: { length: 1 }, appendChild: (el: El) => { p.shown.push(el); } },
      createElement: (tag: string): El => {
        const el: El = { tag, textContent: "", style: {}, attrs: {}, kids: [], clicks: [], setAttribute(k, v) { el.attrs[k] = v; }, appendChild(c) { el.kids.push(c); }, addEventListener(e, fn) { if (e === "click") el.clicks.push(fn); } };
        return el;
      },
    },
    Promise, String, Number,
  };
  win["window"] = win;
  const ctx = vm.createContext(win);
  p.settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
  p.run = (src) => { vm.runInContext(src, ctx); };
  p.advance = async (ms) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift();
      now = t.at;
      t.fn();
      await p.settle();
    }
    now = end;
  };
  return p;
}
const reports = (p: Page, kind: string): string[] => p.calls.filter((c) => c.cmd === "page_report" && c.args["kind"] === kind).map((c) => c.args["text"]!);
const recovers = (p: Page): Call[] => p.calls.filter((c) => c.cmd === "page_recover");

test("a page an earlier version's worker served: the worker and its caches go, and the page loads again once the shell allows it", async () => {
  const p = page({ workers: 1, controlled: true, caches: ["expo-v1"] });
  p.run(script("NO_SERVICE_WORKER"));
  await p.settle();
  assert.equal(p.unregistered, 1);
  assert.deepEqual(p.deleted, ["expo-v1"]);
  assert.match(reports(p, "service-worker")[0] ?? "", /^removed 1 service worker\(s\) an earlier version registered; loading again$/);
  assert.deepEqual(recovers(p).map((c) => c.args["kind"]), ["service-worker"], "the shell is asked, so it can bound the reloads");
  assert.deepEqual(p.replaced, ["/"]);
});

test("the shell refuses another load: the worker is still removed, and the page is not loaded again", async () => {
  const p = page({ workers: 1, controlled: true, allow: false });
  p.run(script("NO_SERVICE_WORKER"));
  await p.settle();
  assert.equal(p.unregistered, 1);
  assert.equal(recovers(p).length, 1);
  assert.deepEqual(p.replaced, [], "no reload past the shell's bound, so it can never loop");
});

test("a worker left registered but not serving this page (the app served it): removed, and the page that already draws is not loaded again", async () => {
  const p = page({ workers: 1, controlled: false, caches: ["expo-v1"], text: "Welcome to Vyre" });
  p.run(script("NO_SERVICE_WORKER"));
  await p.settle();
  assert.equal(p.unregistered, 1);
  assert.deepEqual(p.deleted, ["expo-v1"]);
  assert.match(reports(p, "service-worker")[0] ?? "", /^removed 1 service worker\(s\) an earlier version registered; this page is the app's own, not loaded again$/);
  assert.deepEqual(recovers(p), []);
  assert.deepEqual(p.replaced, []);
});

test("no worker: nothing is removed, said, or loaded again", async () => {
  const p = page({ workers: 0, controlled: false });
  p.run(script("NO_SERVICE_WORKER"));
  await p.settle();
  assert.deepEqual(p.calls, []);
  assert.deepEqual(p.replaced, []);
});

test("a window that has drawn nothing 8 s after loading says what the page shows, then clears workers and caches and loads again when the shell allows it", async () => {
  const p = page({ workers: 1, controlled: true, caches: ["old"], text: "" });
  p.run(script("PAGE_PROBE"));
  await p.advance(2000);
  assert.deepEqual(reports(p, "rendered"), ["0 chars at http://tauri.localhost/"]);
  await p.advance(5900);
  assert.deepEqual(recovers(p), [], "not before 8 s");
  await p.advance(100);
  const blank = reports(p, "blank")[0] ?? "";
  assert.match(blank, /^drew nothing 8 s after loading: http:\/\/tauri\.localhost\/, readyState complete, title "Vyre", 1 element\(s\) in body, page 45 bytes, served by the worker http:\/\/tauri\.localhost\/sw\.js$/);
  assert.deepEqual(recovers(p).map((c) => c.args["kind"]), ["blank"]);
  assert.equal(p.unregistered, 1);
  assert.deepEqual(p.deleted, ["old"]);
  assert.deepEqual(p.replaced, ["/"]);
});

test("a blank window the shell will not load again shows one plain line and a way forward, never an empty window", async () => {
  const p = page({ workers: 1, controlled: true, text: "", allow: false });
  p.run(script("PAGE_PROBE"));
  await p.advance(8000);
  assert.match(reports(p, "blank")[0] ?? "", /served by the worker http:\/\/tauri\.localhost\/sw\.js$/);
  assert.equal(recovers(p).length, 1);
  assert.deepEqual(p.replaced, [], "the shell said no, so the page does not load itself again");
  assert.equal(p.shown.length, 1, "a notice is put on the page");
  const box = p.shown[0]!;
  assert.equal(box.attrs["role"], "alert");
  assert.deepEqual(box.kids.map((k) => [k.tag, k.textContent]), [["div", "Vyre did not open properly."], ["button", "Open again"]]);
  assert.match(reports(p, "blank")[1] ?? "", /^showed the notice/);
  // the person presses Open again: workers and caches go and the page loads again (a person's press, not bounded by the shell)
  box.kids[1]!.clicks[0]!();
  await p.settle();
  assert.equal(p.unregistered, 1);
  assert.deepEqual(p.replaced, ["/"]);
});

test("a blank window with no worker: still a notice when the shell says no", async () => {
  const p = page({ workers: 0, text: "", allow: false });
  p.run(script("PAGE_PROBE"));
  await p.advance(8000);
  assert.match(reports(p, "blank")[0] ?? "", /served by no worker$/);
  assert.equal(p.shown.length, 1);
});

test("a window that draws is left alone", async () => {
  const p = page({ workers: 1, controlled: true, text: "Welcome to Vyre" });
  p.run(script("PAGE_PROBE"));
  await p.advance(20_000);
  assert.deepEqual(reports(p, "rendered"), ["15 chars at http://tauri.localhost/"]);
  assert.deepEqual(reports(p, "blank"), []);
  assert.deepEqual(recovers(p), []);
  assert.deepEqual(p.replaced, []);
  assert.deepEqual(p.shown, []);
});

test("the shell bounds how often a page may load itself again, and says each time in its log", () => {
  const commands = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "src", "commands.rs"), "utf8");
  assert.match(commands, /pub fn page_recover\(/);
  assert.match(commands, /MAX_PAGE_RECOVERIES: u32 = 3/);
  assert.match(LIB, /commands::page_recover,/, "the command is registered");
});
