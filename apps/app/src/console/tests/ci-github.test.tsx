// Console > Computers > CI runners and Console > Apps > GitHub, mounted for real. The server is a scripted call that records every capability and its input,
// so each control is proved by the capability it calls. Reads come from dataWith (the sheet-helper), the way ai-accounts.test.tsx does it.
import test from "node:test";
import assert from "node:assert/strict";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../ui/src/testing/dom.ts";
import { ConsoleDataProvider } from "../shell/data.tsx";
import { createSampleConsole, SAMPLE_NOW } from "../shell/sample.ts";
import { CAPS, CiRunnersPage, STACK_BELOW, stackPickers, stackRunEnd, accountWord, dayStart, dollars, durationWord, isPaused, longestToday, pickEntries, raisedCap, runTitle, runUrl, runWord, runsToday, settingEntries, sinceWord, todayBreakdown } from "../pages/CiRunners.tsx";
import { GithubAppPage, secretWord, valueWord, appComplete, installUrl, manifestReturn, ownLine, postManifest } from "../pages/GithubApp.tsx";
import { dataWith } from "./sheet-helper.tsx";

const SETTINGS = { enabled: false, provider: "digitalocean", vaultKeyRef: "#Northwind_DO", region: "nyc3", size: "s-4vcpu-8gb", image: "ubuntu-24-04-x64", maxConcurrent: 3, monthlyCapUsd: 50, maxJobMinutes: 30, labels: ["vyre"] };
const READY = { ready: true, installed: true, missing: [], acceptUrl: null, orgAcceptUrl: null };
const settingsOut = (over: Record<string, unknown> = {}, githubApp: Record<string, unknown> = READY) => ({ settings: { ...SETTINGS, ...over }, keyReady: true, githubApp });
const cost = (over: Record<string, unknown> = {}) => ({ month: "2025-10", spentUsd: 4.12, capUsd: 50, leftUsd: 45.88, runs: 212, paused: false, byRepo: [{ repo: "northwind/website", runs: 212, costUsd: 4.12 }], ...over });
const min = 60_000;
const run = (id: string, over: Record<string, unknown> = {}) => ({ runId: id, jobId: 11, workflowRunId: 99, repo: "northwind/website", jobName: "tests", projectId: null, state: "finished", dropletId: "d1", size: "s-4vcpu-8gb", queuedAt: SAMPLE_NOW - 12 * min, startedAt: SAMPLE_NOW - 12 * min, endedAt: SAMPLE_NOW - 8 * min, conclusion: "failure", costUsd: 0.01, note: "3 tests failing", ...over });
const RUNS = [run("cir_1"), run("cir_2", { jobName: "lint", conclusion: "success", note: null, endedAt: SAMPLE_NOW - 11 * min }), run("cir_3", { jobName: "e2e", state: "swept", conclusion: null, note: "Removed a machine that ran past the time limit", endedAt: SAMPLE_NOW - 3 * min })];

async function ci(rows: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const restore = installDom();
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "ci.runs.list") return { runs: RUNS };
    if (cap === "ci.settings.set") return { settings: SETTINGS };
    throw new Error(`unscripted ${cap}`);
  };
  const base = createSampleConsole().data;
  const nav = { ...base.nav, openApp: (t?: { screen: string }) => { opened.push(`app:${t?.screen}`); }, openPage: (id: string) => { opened.push(`page:${id}`); } };
  (globalThis as { open?: unknown }).open = (url: string) => { opened.push(`url:${url}`); };
  const { createRoot } = await import("test-renderer");
  const root = await mount(createRoot, <ConsoleDataProvider value={dataWith(rows, { call: call as never, nav: nav as never, ...extra })}><CiRunnersPage /></ConsoleDataProvider>);
  await flush();
  return { root, calls, opened, restore };
}
const writes = (calls: Array<{ cap: string }>, cap: string) => calls.filter((c) => c.cap === cap);
const tap = async (root: Node, id: string) => { const n = find(root, id); assert.ok(n, `${id} is on the page`); await press(n); await flush(); };

test("the words: dollars, how long, the state of a run, the next cap up, the paused rule", () => {
  assert.equal(dollars(4.12), "$4.12"); assert.equal(dollars(50), "$50"); assert.equal(dollars(0.01), "$0.01");
  assert.equal(durationWord(228_000), "3\u00a0m\u00a048\u00a0s"); assert.equal(durationWord(58_000), "58\u00a0s");
  assert.equal(durationWord(180_000), "3\u00a0m\u00a000\u00a0s", "a number and its unit never split across lines");
  assert.deepEqual(runWord(run("a") as never), { word: "Failed", tone: "bad" });
  assert.deepEqual(runWord(run("a", { conclusion: "success" }) as never), { word: "Passed", tone: "ok" });
  assert.deepEqual(runWord(run("a", { state: "running" }) as never), { word: "Running", tone: "warn" });
  assert.deepEqual(runWord(run("a", { state: "swept" }) as never), { word: "Stopped", tone: "warn" });
  assert.deepEqual(runWord(run("a", { state: "queued" }) as never), { word: "Waiting", tone: "off" });
  assert.equal(raisedCap(50, 50), 100); assert.equal(raisedCap(300, 250), 600); assert.deepEqual([...CAPS], [4, 25, 50, 100, 250]);
  assert.equal(runUrl(run("a") as never), "https://github.com/northwind/website/actions/runs/99/job/11");
  assert.equal(isPaused(settingsOut({ enabled: true }) as never, cost({ spentUsd: 50 }) as never), true);
  assert.equal(isPaused(settingsOut({ enabled: false }) as never, cost({ spentUsd: 50 }) as never), false);
  const e = pickEntries([{ value: 1, title: "1" }, { value: 2, title: "2" }], 7, () => undefined);
  assert.deepEqual(e.map((x) => x.label), ["7", "1", "2"], "a value the Space already has stays on the list");
  assert.ok(settingEntries("monthlyCapUsd", 50, 30, () => undefined as never).some((x) => /below this month's cost/.test(x.label)));
});

test("the day's numbers: only today's runs count, and the breakdown adds up to the count", () => {
  const day = dayStart(SAMPLE_NOW);
  const rows = [run("t1"), run("t2", { conclusion: "success", endedAt: SAMPLE_NOW - 10 * min }), run("t3", { state: "running", endedAt: null }), run("t4", { state: "swept", conclusion: null }), run("t5", { state: "queued", startedAt: null, endedAt: null }),
    run("y1", { queuedAt: day - 1, startedAt: day - 40 * min, endedAt: day - 1 }), run("y2", { queuedAt: day - 5 * min, startedAt: day - 90 * min, endedAt: day - 5 * min, conclusion: "success" })] as never[];
  const today = runsToday(rows, SAMPLE_NOW);
  assert.deepEqual(today.map((r) => r.runId), ["t1", "t2", "t3", "t4", "t5"], "yesterday's runs are not today's");
  const b = todayBreakdown(today);
  assert.equal(b.total, 5); assert.equal(b.parts.reduce((n, p) => n + p.n, 0), b.total, "the parts add up");
  assert.equal(b.line, "1 failed, 1 passed, 1 stopped, 1 running, 1 waiting");
  assert.equal(todayBreakdown([]).line, "Nothing yet today");
  assert.equal(longestToday(today, SAMPLE_NOW), 12 * min + 0, "the longest is a run of today (a running one counts to now), never yesterday's 40 min");
  assert.equal(longestToday([], SAMPLE_NOW), undefined);
  assert.equal(sinceWord("2026-11"), "1 Nov"); assert.equal(runTitle("Checks / tests"), "Checks · tests"); assert.equal(runTitle("tests"), "tests");
  assert.equal(accountWord([{ name: "DigitalOcean, Northwind", handle: "#Northwind_DO" }], "#Northwind_DO"), "DigitalOcean, Northwind (Vault)");
  assert.equal(accountWord([], "#Northwind_DO"), "#Northwind_DO"); assert.equal(accountWord([], null), "Not set");
});

test("off: it says what CI runners are and has Turn on, and no cost or run is drawn", async () => {
  const { root, restore } = await ci({ "ci.settings.get": settingsOut() });
  try {
    const text = textOf(root);
    assert.match(text, /CI runners are off/);
    assert.match(text, /Run your GitHub checks on throwaway machines from your own cloud account\. Nothing runs on people's computers\./);
    assert.match(text, /GitHub minutes are never used, and the Space server never runs a job\./);
    assert.ok(find(root, "ci-turn-on") && !find(root, "row-ci-month"));
    assert.ok(find(root, "ci-off") && !find(root, "row-ci-off"), "one centered card, not a row");
  } finally { restore(); }
});

test("Turn on opens the sheet; Turn on there calls ci.settings.set with enabled and every choice", async () => {
  const { root, calls, restore } = await ci({ "ci.settings.get": settingsOut(), "vault.items.list": { items: [{ id: "vit_1", name: "Northwind DigitalOcean", handle: "#Northwind_DO" }], counts: {} } });
  try {
    await tap(root, "ci-turn-on");
    const sheet = textOf(find(root, "ci-on-sheet"));
    assert.match(sheet, /Turn on CI runners/); assert.match(sheet, /Northwind DigitalOcean/); assert.match(sheet, /New York \(nyc3\)/); assert.match(sheet, /4 vCPU, 8 GB/); assert.match(sheet, /\$50/);
    await tap(root, "sheet-submit");
    assert.deepEqual(writes(calls, "ci.settings.set").map((c) => c.input), [{ enabled: true, vaultKeyRef: "#Northwind_DO", region: "nyc3", size: "s-4vcpu-8gb", maxConcurrent: 3, maxJobMinutes: 30, monthlyCapUsd: 50 }]);
  } finally { restore(); }
});

test("the Turn on sheet will not turn on without a cloud account, and a pick in it changes what is sent", async () => {
  const none = await ci({ "ci.settings.get": settingsOut({ vaultKeyRef: null }), "vault.items.list": { items: [{ id: "vit_1", name: "Northwind DigitalOcean", handle: "#Northwind_DO" }], counts: {} } });
  try {
    await tap(none.root, "ci-turn-on");
    assert.match(textOf(find(none.root, "ci-on-sheet")), /Choose from Vault/);
    await tap(none.root, "sheet-submit");
    assert.equal(writes(none.calls, "ci.settings.set").length, 0, "nothing is sent without an account");
    await tap(none.root, "ci-sheet-account");
    await tap(none.root, "menu-item-Northwind DigitalOcean");
    await tap(none.root, "ci-sheet-region");
    await tap(none.root, "menu-item-Frankfurt (fra1)");
    await tap(none.root, "ci-sheet-cap");
    await tap(none.root, "menu-item-$100");
    await tap(none.root, "sheet-submit");
    assert.deepEqual(writes(none.calls, "ci.settings.set").map((c) => c.input), [{ enabled: true, vaultKeyRef: "#Northwind_DO", region: "fra1", size: "s-4vcpu-8gb", maxConcurrent: 3, maxJobMinutes: 30, monthlyCapUsd: 100 }]);
  } finally { none.restore(); }
  const vault = await ci({ "ci.settings.get": settingsOut({ vaultKeyRef: null }), "vault.items.list": { items: [], counts: {} } });
  try {
    await tap(vault.root, "ci-turn-on"); await tap(vault.root, "ci-sheet-account"); await tap(vault.root, "menu-item-Add one in Vault…");
    assert.deepEqual(vault.opened, ["app:vault.layout"], "Add one in Vault opens Vault");
  } finally { vault.restore(); }
});

test("on: the month's cost against the cap, the runs with their states and cost, and the settings", async () => {
  const { root, calls, restore } = await ci({ "ci.settings.get": settingsOut({ enabled: true }), "ci.cost.month": cost() });
  try {
    const text = textOf(root);
    assert.match(text, /This month\s*\$4\.12 of \$50\s*212 jobs since 1 Oct/);
    assert.ok(find(root, "ci-bar") && find(root, "ci-longest") && find(root, "ci-today"), "four tiles");
    assert.match(textOf(find(root, "ci-today")), /Runs today\s*3\s*1 failed, 1 passed, 1 stopped/);
    assert.match(text, /Machines running now/); assert.match(text, /Up to 3 at once/); assert.match(text, /The limit is 30 min per job/);
    assert.deepEqual(calls.filter((c) => c.cap === "ci.runs.list").map((c) => c.input), [{ repo: "northwind/website", limit: 50 }], "the runs are read for each repository that cost something");
    assert.equal(textOf(find(root, "ci-run-state-cir_1")).trim(), "Failed");
    assert.equal(textOf(find(root, "ci-run-state-cir_2")).trim(), "Passed");
    assert.match(textOf(find(root, "row-ci-run-cir_1")), /northwind\/website · 12 min ago · 4\sm\s00\ss · 3 tests failing/);
    assert.ok(find(root, "icon-tile-xc") && find(root, "icon-tile-ok") && find(root, "icon-tile-clock"), "a status tile leads each run");
    assert.match(text, /Pull requests from outside the team/); assert.match(text, /Never used for CI/);
    assert.ok(!find(root, "row-ci-paused"));
  } finally { restore(); }
});

test("a run opens a sheet that reads ci.runs.get and links to the job on GitHub", async () => {
  const { root, calls, opened, restore } = await ci({ "ci.settings.get": settingsOut({ enabled: true }), "ci.cost.month": cost(), "ci.runs.get": { run: RUNS[0] } });
  try {
    await tap(root, "row-ci-run-cir_1");
    assert.ok(calls.some((c) => c.cap === "ci.runs.get") || find(root, "ci-run-sheet"), "the run is read");
    const text = textOf(find(root, "ci-run-sheet"));
    assert.match(text, /tests/); assert.match(text, /northwind\/website/); assert.match(text, /4 vCPU, 8 GB machine/); assert.match(text, /3 tests failing/);
    await tap(root, "ci-run-github");
    assert.deepEqual(opened, ["url:https://github.com/northwind/website/actions/runs/99/job/11"]);
    await tap(root, "ci-run-close");
    assert.equal(find(root, "ci-run-sheet"), null);
  } finally { restore(); }
});

test("Cleanup shows the last sweep and its Details sheet lists every machine the sweeper deleted", async () => {
  const { root, restore } = await ci({ "ci.settings.get": settingsOut({ enabled: true }), "ci.cost.month": cost() });
  try {
    assert.match(textOf(find(root, "row-ci-cleanup")), /Sweeper[\s\S]*Removed a machine that ran past the time limit, 3 min ago/);
    assert.ok(find(root, "icon-tile-trash"));
    await tap(root, "ci-cleanup-open");
    const text = textOf(find(root, "ci-log-sheet"));
    assert.match(text, /Cleanup log/); assert.match(text, /Removed a machine that ran past the time limit/); assert.match(text, /northwind\/website · e2e/);
  } finally { restore(); }
});

test("the cloud account is a pick that reads the Vault item's name and saves its handle", async () => {
  const { root, calls, restore } = await ci({ "ci.settings.get": settingsOut({ enabled: true }), "ci.cost.month": cost(), "vault.items.list": { items: [{ id: "vit_1", name: "DigitalOcean, Northwind", handle: "#Northwind_DO" }, { id: "vit_2", name: "DigitalOcean, Labs", handle: "#Labs_DO" }], counts: {} } });
  try {
    assert.match(textOf(find(root, "row-ci-cloud")), /DigitalOcean, Northwind \(Vault\)/); assert.ok(!/#Northwind_DO/.test(textOf(find(root, "row-ci-cloud"))));
    await tap(root, "ci-pick-account"); await tap(root, "menu-item-DigitalOcean, Labs");
    assert.deepEqual(writes(calls, "ci.settings.set").map((c) => c.input), [{ vaultKeyRef: "#Labs_DO" }]);
    for (const icon of ["key", "globe", "cpu", "play", "clock", "card"]) assert.ok(find(root, `icon-tile-${icon}`), `${icon} tile`);
  } finally { restore(); }
});

test("each setting is a pick that calls ci.settings.set with that one field", async () => {
  const { root, calls, restore } = await ci({ "ci.settings.get": settingsOut({ enabled: true }), "ci.cost.month": cost() });
  try {
    const set = () => writes(calls, "ci.settings.set").map((c) => c.input);
    await tap(root, "ci-pick-region"); await tap(root, "menu-item-Singapore (sgp1)");
    await tap(root, "ci-pick-size"); await tap(root, "menu-item-8 vCPU, 16 GB");
    await tap(root, "ci-pick-max"); await tap(root, "menu-item-5");
    await tap(root, "ci-pick-mins"); await tap(root, "menu-item-60 min");
    await tap(root, "ci-pick-cap"); await tap(root, "menu-item-$250");
    assert.deepEqual(set(), [{ region: "sgp1" }, { size: "s-8vcpu-16gb" }, { maxConcurrent: 5 }, { maxJobMinutes: 60 }, { monthlyCapUsd: 250 }]);
  } finally { restore(); }
});

test("paused at the cap: the line says so and Raise cap calls ci.settings.set with the next cap", async () => {
  const { root, calls, restore } = await ci({ "ci.settings.get": settingsOut({ enabled: true }), "ci.cost.month": cost({ spentUsd: 50.2, leftUsd: 0, paused: true }) });
  try {
    assert.match(textOf(find(root, "row-ci-paused")), /CI paused: this month's cap of \$50 is reached/);
    assert.match(textOf(find(root, "section-Needs you")), /Needs you/, "the paused line is the Needs you row");
    await tap(root, "ci-raise-cap");
    assert.deepEqual(writes(calls, "ci.settings.set").map((c) => c.input), [{ monthlyCapUsd: 100 }]);
  } finally { restore(); }
});

test("Turn off CI runners asks first, then calls ci.settings.set with enabled false; Cancel sends nothing", async () => {
  const { root, calls, restore } = await ci({ "ci.settings.get": settingsOut({ enabled: true }), "ci.cost.month": cost() });
  try {
    await tap(root, "ci-turn-off");
    assert.match(textOf(find(root, "ci-off-confirm")), /Jobs already running finish first\. New jobs go back to GitHub's own runners\./);
    await tap(root, "ci-off-cancel");
    assert.equal(writes(calls, "ci.settings.set").length, 0);
    await tap(root, "ci-turn-off"); await tap(root, "ci-off-yes");
    assert.deepEqual(writes(calls, "ci.settings.set").map((c) => c.input), [{ enabled: false }]);
  } finally { restore(); }
});

test("the GitHub app line: new permissions to accept, or an app that is not installed", async () => {
  const need = await ci({ "ci.settings.get": settingsOut({}, { ready: false, installed: true, missing: ["actions: read"], acceptUrl: "https://github.com/settings/installations/7/permissions/update", orgAcceptUrl: null }) });
  try {
    assert.match(textOf(find(need.root, "row-ci-github-perms")), /Northwind's GitHub app needs new permissions/);
    await tap(need.root, "ci-github-accept");
    assert.deepEqual(need.opened, ["url:https://github.com/settings/installations/7/permissions/update"]);
  } finally { need.restore(); }
  const none = await ci({ "ci.settings.get": settingsOut({}, { ready: false, installed: false, missing: [], acceptUrl: null, orgAcceptUrl: null }) });
  try {
    await tap(none.root, "ci-github-setup");
    assert.deepEqual(none.opened, ["page:ghapp"], "Set up GitHub opens the GitHub tab");
  } finally { none.restore(); }
});

// ---- Apps > GitHub

const SIGN = (over: Record<string, unknown> = {}) => ({ github: { secretSet: false, source: "none", callbackUrl: "https://northwind.vyre.run/auth/github/callback", createUrl: "https://github.com/settings/applications/new", ...over } });
const APP = { id: 123456, slug: "northwind-vyre", name: "Northwind Vyre", permissions: { contents: "write" }, events: ["push"] };
async function gh(rows: Record<string, unknown>, scripted: Record<string, unknown> = {}) {
  const restore = installDom();
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap in scripted) return scripted[cap];
    if (cap === "members.sign_in_github.set" || cap === "members.sign_in_github.clear") return { github: SIGN().github };
    throw new Error(`unscripted ${cap}`);
  };
  (globalThis as { open?: unknown }).open = (url: string) => { opened.push(`url:${url}`); };
  const { createRoot } = await import("test-renderer");
  const root = await mount(createRoot, <ConsoleDataProvider value={dataWith(rows, { call: call as never })}><GithubAppPage /></ConsoleDataProvider>);
  await flush();
  return { root, calls, opened, restore };
}
const MADE = { "github.app.get": APP, "github.installations.list": { installations: [{ id: 77, account: "northwind", repositorySelection: "selected" }] } };

test("GitHub: the words, the addresses, and what GitHub sends back", () => {
  assert.equal(ownLine(false, false, "Northwind"), "Off. Members use the Vyre GitHub app");
  assert.equal(ownLine(true, false, "Northwind"), "Not working yet. Add the values below or create the app for us");
  assert.equal(ownLine(true, true, "Northwind"), "Members sign in and connect GitHub through Northwind's app");
  assert.equal(appComplete(SIGN().github as never, null), false);
  assert.equal(appComplete(SIGN({ clientId: "Iv1.x", secretSet: true }).github as never, null), true);
  assert.equal(appComplete(SIGN().github as never, APP as never), true);
  assert.equal(installUrl("northwind-vyre"), "https://github.com/apps/northwind-vyre/installations/new");
  assert.deepEqual(manifestReturn("?code=abc12345&state=0123456789abcdef0123456789abcdef"), { code: "abc12345", state: "0123456789abcdef0123456789abcdef" });
  assert.equal(manifestReturn("?code=abc12345"), null);
  const opened: string[] = [];
  const g = globalThis as { open?: unknown; document?: unknown };
  const hadDoc = "document" in g, had = g.document; delete g.document; g.open = (u: string) => { opened.push(u); };
  postManifest({ manifest: { name: "x" }, postUrl: "https://github.com/organizations/northwind/settings/apps/new?state=1" });
  if (hadDoc) g.document = had;
  delete g.open;
  assert.deepEqual(opened, ["https://github.com/organizations/northwind/settings/apps/new?state=1"], "without a page to post from, the address opens");
});

test("off: members use the Vyre GitHub app, and nothing else is drawn but the line", async () => {
  const { root, restore } = await gh({ "members.sign_in_github.get": SIGN(), "ci.settings.get": settingsOut() });
  try {
    const text = textOf(root);
    assert.match(text, /Use our own GitHub app/); assert.match(text, /Off\. Members use the Vyre GitHub app/);
    assert.match(text, /The Vyre GitHub app needs nothing from you\./);
    assert.ok(!find(root, "gh-create") && !find(root, "gh-keys"));
  } finally { restore(); }
});

test("switching on shows the values from Vault, Create one for us and the installation; not working yet until they are set", async () => {
  const { root, restore } = await gh({ "members.sign_in_github.get": SIGN(), "ci.settings.get": settingsOut() });
  try {
    await tap(root, "gh-own-switch");
    const text = textOf(root);
    assert.match(text, /Not working yet\. Add the values below or create the app for us/);
    for (const t of ["App id", "Private key", "Client id", "Client secret", "Not installed"]) assert.match(text, new RegExp(t));
    assert.ok(find(root, "gh-create") && find(root, "gh-keys"));
    assert.match(text, /Northwind uses its own GitHub app\. Reconnect once\./);
  } finally { restore(); }
});

test("own app: id, key and secret say Vault, each has a key tile; the installation and the footer name the Space", async () => {
  const { root, restore } = await gh({ "members.sign_in_github.get": SIGN({ clientId: "Iv1.abc", secretSet: true, source: "space" }), "ci.settings.get": settingsOut() }, MADE);
  try {
    const text = textOf(root);
    assert.match(textOf(find(root, "row-gh-app-id")), /Vault: GITHUB_APP_ID/); assert.match(textOf(find(root, "row-gh-app-key")), /Vault: GITHUB_APP_PRIVATE_KEY/); assert.match(textOf(find(root, "row-gh-client-secret")), /Vault: GITHUB_APP_CLIENT_SECRET/);
    assert.ok(find(root, "logo-github"), "the GitHub mark leads");
    assert.match(text, /The Space's installation/);
    assert.match(text, /Northwind uses its own GitHub app\. Reconnect once\./);
  } finally { restore(); }
});

test("Use an app we already made saves the client id and secret with members.sign_in_github.set", async () => {
  const { root, calls, restore } = await gh({ "members.sign_in_github.get": SIGN(), "ci.settings.get": settingsOut() });
  try {
    await tap(root, "gh-own-switch"); await tap(root, "gh-keys");
    await tap(root, "sheet-submit");
    assert.equal(writes(calls, "members.sign_in_github.set").length, 0, "empty fields send nothing");
    await typeInto(find(root, "gh-field-id"), "Iv1.abc"); await typeInto(find(root, "gh-field-secret"), "s3cret");
    await tap(root, "sheet-submit");
    assert.deepEqual(writes(calls, "members.sign_in_github.set").map((c) => c.input), [{ clientId: "Iv1.abc", clientSecret: "s3cret" }]);
  } finally { restore(); }
});

test("Create one for us asks GitHub for the manifest with members' org and the app name, then waits for the confirm", async () => {
  const out = { manifest: { name: "Northwind Vyre" }, postUrl: "https://github.com/organizations/northwind/settings/apps/new?state=abc", state: "abc" };
  const { root, calls, opened, restore } = await gh({ "members.sign_in_github.get": SIGN(), "ci.settings.get": settingsOut() }, { "github.app.create_manifest": out });
  try {
    await tap(root, "gh-own-switch"); await tap(root, "gh-create");
    assert.match(textOf(find(root, "gh-create-sheet")), /Sign-in callback/);
    await tap(root, "sheet-submit");
    assert.equal(writes(calls, "github.app.create_manifest").length, 0, "no organization, nothing sent");
    await typeInto(find(root, "gh-field-org"), "northwind");
    await tap(root, "sheet-submit");
    assert.deepEqual(writes(calls, "github.app.create_manifest").map((c) => c.input), [{ org: "northwind", name: "Northwind Vyre" }]);
    assert.match(textOf(find(root, "gh-create-sheet")), /Confirm the app on GitHub/);
    assert.deepEqual(opened, [`url:${out.postUrl}`], "GitHub opens");
  } finally { restore(); }
});

test("an app that exists shows its id and the installation, Install and Change open GitHub, Check again reads the installations", async () => {
  const none = await gh({ "members.sign_in_github.get": SIGN({ clientId: "Iv1.abc", secretSet: true, source: "space" }), "ci.settings.get": settingsOut() }, { "github.app.get": APP, "github.installations.list": { installations: [] } });
  try {
    assert.match(textOf(none.root), /123456/); assert.match(textOf(none.root), /Members sign in and connect GitHub through Northwind's app/);
    assert.match(textOf(find(none.root, "row-gh-no-install")), /Not installed/);
    await tap(none.root, "gh-install");
    assert.deepEqual(none.opened, ["url:https://github.com/apps/northwind-vyre/installations/new"]);
  } finally { none.restore(); }
  const made = await gh({ "members.sign_in_github.get": SIGN({ clientId: "Iv1.abc", secretSet: true, source: "space" }), "ci.settings.get": settingsOut() }, MADE);
  try {
    assert.match(textOf(find(made.root, "row-gh-install-77")), /northwind/); assert.match(textOf(find(made.root, "row-gh-install-77")), /Selected repositories/);
    await tap(made.root, "gh-change-77");
    assert.deepEqual(made.opened, ["url:https://github.com/settings/installations/77"]);
    const before = writes(made.calls, "github.installations.list").length;
    await tap(made.root, "gh-recheck");
    assert.ok(writes(made.calls, "github.installations.list").length > before, "Check again reads the installations");
  } finally { made.restore(); }
});

test("switching off asks first, then members.sign_in_github.clear puts members back on the Vyre app", async () => {
  const { root, calls, restore } = await gh({ "members.sign_in_github.get": SIGN({ clientId: "Iv1.abc", secretSet: true, source: "space" }), "ci.settings.get": settingsOut() }, MADE);
  try {
    await tap(root, "gh-own-switch");
    assert.equal(writes(calls, "members.sign_in_github.clear").length, 0, "the first press only asks");
    assert.match(textOf(find(root, "gh-off-confirm")), /Go back to the Vyre GitHub app\?/);
    await tap(root, "gh-off-cancel");
    assert.equal(writes(calls, "members.sign_in_github.clear").length, 0);
    await tap(root, "gh-own-switch"); await tap(root, "gh-off-yes");
    assert.deepEqual(writes(calls, "members.sign_in_github.clear").map((c) => c.input), [{}]);
  } finally { restore(); }
});

test("when the app needs new permissions the GitHub tab says so with Accept on GitHub", async () => {
  const { root, opened, restore } = await gh({ "members.sign_in_github.get": SIGN({ clientId: "Iv1.abc", secretSet: true, source: "space" }), "ci.settings.get": settingsOut({}, { ready: false, installed: true, missing: ["actions: read"], acceptUrl: null, orgAcceptUrl: "https://github.com/organizations/northwind/settings/installations/7/permissions/update" }) }, MADE);
  try {
    assert.match(textOf(find(root, "row-ci-github-perms")), /Northwind's GitHub app needs new permissions/);
    await tap(root, "ci-github-accept");
    assert.deepEqual(opened, ["url:https://github.com/organizations/northwind/settings/installations/7/permissions/update"]);
  } finally { restore(); }
});

test("a setting's picker stacks under its label below 760 wide, and not on a wide or an unmeasured screen", () => {
  assert.equal(STACK_BELOW, 760);
  assert.equal(stackPickers(390), true); assert.equal(stackPickers(759), true);
  assert.equal(stackPickers(760), false); assert.equal(stackPickers(1440), false); assert.equal(stackPickers(0), false);
  assert.equal(stackRunEnd(390), true); assert.equal(stackRunEnd(1440), false);
});

test("App details values: a secret reads Set in Vault, a missing value reads Not set", () => {
  assert.equal(secretWord(true), "Set in Vault"); assert.equal(secretWord(false), "Not set");
  assert.equal(valueWord(undefined), "Not set"); assert.equal(valueWord(null), "Not set"); assert.equal(valueWord(""), "Not set");
  assert.equal(valueWord(42), "42"); assert.equal(valueWord("Iv1.abc"), "Iv1.abc");
});
