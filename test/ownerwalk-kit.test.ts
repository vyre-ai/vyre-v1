// The owner walk kit (lane f-ownerwalk, 12 Nov 2026): a Space booted the way a person starts it, the production web export in Chromium, the owner claiming it through the real claim screens, and a
// picture of each step in light and dark at the widths a person uses. Every step records what broke (an error page, a script error, a refused call) and the walk goes on, so one run lists everything.
// The model is a stand-in that streams a short plain reply word by word (and, for `TOOL <name> <json>`, calls that tool as a model would); nothing else inside the daemon is faked.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright-core";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";
import { fakePlatform } from "../host/src/platform/index.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../host/src/daemon/daemon.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import { claimOnEdge, dismissOnboarding, edge } from "../apps/app/tests/real-app-harness.test.ts";
import type { Edge } from "../apps/app/tests/real-app-harness.test.ts";

export const PASSWORD = "fixture password 123";
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The reply a person reads: one short sentence that names what was asked, streamed a word at a time. "LONG" in the message makes a reply of about ten seconds, for Stop. */
export function replyFor(body: string): string {
  const asked = body.replace(/\s+/g, " ").trim().slice(0, 80);
  if (/LONG/.test(body)) return Array.from({ length: 60 }, (_, i) => `Step ${i + 1} of the plan is written out here in plain words.`).join(" ");
  return `Sure. Here is what I found about "${asked}": the three items are ready, and I put a short summary in the project notes.`;
}

/** The stand-in model: plain streamed text, or a tool call for `TOOL <name> <json>` (found with tool_search first, as a model must). */
export const walkModel: OpenSession = async () => {
  const waiting = new Map<string, (r: { ok: boolean; content: unknown }) => void>();
  let stopped = false;
  return {
    warm: true,
    async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
      stopped = false;
      const body = String(input.trigger?.body ?? "");
      const m = /TOOL (\w+) (\{.*\})/.exec(body);
      if (!m && body.startsWith("The request:")) { yield { type: "text", text: "Launch week plan" }; yield { type: "done" }; return; }
      if (!m) {
        for (const w of replyFor(body).split(" ")) { if (stopped) break; yield { type: "text", text: `${w} ` }; await sleep(/LONG/.test(body) ? 40 : 25); }
        yield { type: "usage", inputTokens: 900, outputTokens: 60 };
        yield { type: "done" };
        return;
      }
      const first = `call_${waiting.size + 1}`;
      const found = new Promise<{ ok: boolean; content: unknown }>((resolve) => waiting.set(first, resolve));
      yield { type: "tool_call", id: first, name: "tool_search", input: { query: m[1]! } };
      await found;
      const id = `call_${waiting.size + 1}`;
      const result = new Promise<{ ok: boolean; content: unknown }>((resolve) => waiting.set(id, resolve));
      yield { type: "tool_call", id, name: m[1]!, input: JSON.parse(m[2]!) };
      const r = await result;
      yield { type: "text", text: r.ok ? "Done. It worked." : `That did not work: ${JSON.stringify(r.content).slice(0, 120)}` };
      yield { type: "done" };
    },
    sendToolResult(callId: string, result: { ok: boolean; content: unknown }) { waiting.get(callId)?.(result); },
    inject() {}, async cancel() { stopped = true; }, async close() {},
  } as EngineSession;
};

export interface Walk {
  web: Edge; daemon: Daemon; browser: Browser; context: Context; page: Page; dir: string;
  /** The owner's session token (after claim). */
  token: string;
  api(cap: string, data?: unknown, as?: string): Promise<{ status: number; data: any }>;   // eslint-disable-line @typescript-eslint/no-explicit-any
  /** One step: runs, records a failure and goes on. */
  step(label: string, body: () => Promise<void>): Promise<void>;
  /** Pictures of what is on screen now: each width, light then dark (the device's scheme; the Space skin is System), named <n>-<name>-<width>-<scheme>.png. */
  shot(name: string, o?: { page?: Page; widths?: number[]; after?: () => Promise<void> }): Promise<string[]>;
  go(route: string, ready: string, p?: Page): Promise<void>;
  /** A member joins through the real join screens in a new browser; returns their page and token. */
  join(first: string, last: string, username: string, role?: string): Promise<{ page: Page; token: string; personId: string; context: BrowserContext }>;
  /** The daemon stops and starts again on the same data, as an update does; the app's address stays. */
  restart(gapMs?: number): Promise<void>;
  failures: string[]; notes: string[];
  stop(): Promise<void>;
}
type Context = BrowserContext;

export const SHOT_ROOT = process.env["VYRE_OWNERWALK_SHOTS"] ?? path.join(os.tmpdir(), "ownerwalk-shots");

export async function bootWalk(t: { test: (name: string, fn: () => Promise<void>) => Promise<void>; skip(m: string): void }, journey: string, o: { kind?: "personal"; name?: string } = {}): Promise<Walk | null> {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for production browser evidence"); return null; }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-ownerwalk-"));
  let daemonUrl = "";
  const web = await edge(dist, () => daemonUrl);
  const boot = (): ReturnType<typeof startDaemon> => startDaemon({
    config: loadConfig(["--role", "space", "--data-dir", dir, "--port", "0", "--space", `spc_${journey.replace(/\W/g, "")}`, "--space-name", o.name ?? (o.kind === "personal" ? "Personal" : "Northwind Studio"), ...(o.kind ? ["--space-kind", o.kind] : []), "--address", web.origin], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "walk", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
    fetch: () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') }),
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    engineOpenSession: walkModel,
  });
  let daemon = await boot().catch((e: unknown) => { web.close(); throw e; });
  daemonUrl = daemon.url;
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  const out = path.join(SHOT_ROOT, journey); fs.mkdirSync(out, { recursive: true });
  const failures: string[] = [], notes: string[] = [];
  const watch = (p: Page, who: string): void => {
    p.on("pageerror", (e) => { if (!/ResizeObserver/.test(e.message)) notes.push(`${who} pageerror ${new URL(p.url()).pathname}: ${e.message.slice(0, 200)}`); });
    p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon|ResizeObserver/.test(m.text())) notes.push(`${who} console ${new URL(p.url()).pathname}: ${m.text().slice(0, 200)}`); });
    p.on("response", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/v1/") && r.status() >= 400) void r.text().then((b) => notes.push(`${who} ${r.status()} ${u.pathname} ${b.slice(0, 160)}`)).catch(() => undefined); });
  };
  watch(page, "owner");
  let n = 0;
  const w: Walk = {
    web, daemon, browser, context, page, dir, token: "", failures, notes,
    async api(cap, data = {}, as) {
      const r = await context.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${as ?? w.token}` }, data });
      const body = (await r.json().catch(() => ({}))) as { data?: unknown };
      return { status: r.status(), data: body.data ?? body };
    },
    async step(label, body) {
      const before = notes.length;
      await t.test(label, async () => {
        try { await body(); } catch (e) {
          const msg = e instanceof Error ? e.message.split("\n")[0]! : String(e);
          failures.push(`${label}: ${msg.slice(0, 300)}`);
          await page.screenshot({ path: path.join(out, `fail-${String(n).padStart(2, "0")}-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 50)}.png`) }).catch(() => undefined);
          throw e;
        } finally {
          const fresh = notes.slice(before);
          if (fresh.length) console.log(`[${label}] notes:\n  ${fresh.join("\n  ")}`);
        }
      }).catch(() => undefined);
    },
    async shot(name, so = {}) {
      // pictures are evidence for a person to look at: taken when VYRE_OWNERWALK_SHOTS names where they go, skipped in a plain run so the file stays well inside its time cap
      if (!process.env["VYRE_OWNERWALK_SHOTS"]) return [];
      const p = so.page ?? page; const files: string[] = []; const id = String(++n).padStart(2, "0");
      const orig = p.viewportSize() ?? { width: 1280, height: 860 };
      for (const width of so.widths ?? [1280, 1440]) {
        if (width !== p.viewportSize()?.width) { await p.setViewportSize({ width, height: width < 600 ? 844 : 900 }); await sleep(500); }
        for (const scheme of ["light", "dark"] as const) {
          await p.emulateMedia({ colorScheme: scheme }); await sleep(350);
          if (so.after) await so.after();
          const f = path.join(out, `${id}-${name}-${width}-${scheme}.png`);
          await p.screenshot({ path: f, animations: "disabled" }).catch(() => undefined); files.push(f);
        }
      }
      await p.emulateMedia({ colorScheme: "light" });
      if (orig.width !== p.viewportSize()?.width) await p.setViewportSize(orig);
      return files;
    },
    async go(route, ready, p = page) {
      await p.goto(`${web.origin}/${route}`, { waitUntil: "load" });
      await p.getByTestId(ready).first().waitFor({ timeout: 25_000 });
    },
    async join(first, last, username, role = "Member") {
      const roles = (await w.api("access.roles.list")).data.roles as { id: string; name: string }[];
      const inv = (await w.api("members.invites.create", { role: roles.find((r) => r.name === role)!.id, idempotencyKey: `inv-${username}` })).data;
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      const jp = await ctx.newPage(); watch(jp, username);
      const link = new URL(inv.link as string);
      await jp.goto(web.origin + link.pathname + link.hash);
      await jp.getByTestId("step-accept").waitFor({ timeout: 20_000 });
      await jp.getByTestId("web").click(); await jp.getByTestId("first").fill(first); await jp.getByTestId("last").fill(last); await jp.getByTestId("next").click();
      await jp.getByTestId("username").fill(username); await jp.getByTestId("password").fill(PASSWORD); await jp.getByTestId("confirm").fill(PASSWORD); await jp.getByTestId("next").click();
      await jp.getByTestId("device").fill(`${first}'s browser`); await jp.getByTestId("next").click();
      await jp.getByTestId("ai-none").click(); await jp.getByTestId("next").click();
      await dismissOnboarding(jp);
      const s = await jp.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin] as { token: string; personId: string });
      return { page: jp, token: s.token, personId: s.personId, context: ctx };
    },
    async restart(gapMs = 3000) {
      await daemon.stop(); daemonUrl = "";
      await sleep(gapMs);
      daemon = await boot(); daemonUrl = daemon.url; w.daemon = daemon;
    },
    async stop() {
      await browser.close().catch(() => undefined); web.close(); await w.daemon.stop(); fs.rmSync(dir, { recursive: true, force: true });
    },
  };
  // the owner claims the Space through the claim screens
  assert.ok(daemon.claim, "a fresh Space prints a claim link");
  await page.goto(claimOnEdge(daemon.claim!.url, web.origin), { waitUntil: "load" });
  await page.getByTestId("claim-name").fill("Olivia Owner"); await page.getByTestId("claim-username").fill("olivia");
  await page.getByTestId("claim-password").fill(PASSWORD); await page.getByTestId("claim-confirm").fill(PASSWORD);
  await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click();
  await dismissOnboarding(page);
  await page.getByTestId("shell").waitFor({ timeout: 30_000 });
  w.token = await page.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string);
  return w;
}

/** The owner's own AI account, the way the Add an AI provider sheet makes it (a Mine sign-in item, completed), so chats answer through the stand-in. */
export async function connectAi(w: Walk): Promise<void> {
  const folder = (await w.api("vault.folders.create", { name: "Accounts", scope: "mine", idempotencyKey: "ow-f1" })).data.folder.id as string;
  const flow = await w.api("providers.subscription_start", { providerKey: "claude-code", idempotencyKey: "ow-flow" });
  assert.equal(flow.status, 200, `subscription_start ${JSON.stringify(flow.data).slice(0, 200)}`);
  // secret-scan: fake
  const put = await w.api("vault.item.put", { folderId: folder, name: "Olivia_Claude", kind: "ai_subscription", fields: [{ key: "setup_token", value: "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ", secret: true }], idempotencyKey: "ow-i1" });
  assert.equal(put.status, 200, `vault.item.put ${JSON.stringify(put.data).slice(0, 200)}`);
  const done = await w.api("providers.subscription_complete", { flowId: flow.data.flowId });
  assert.equal(done.status, 200, `subscription_complete ${JSON.stringify(done.data).slice(0, 200)}`);
}

/** The composer of the open chat. */
export const composer = (p: Page) => p.getByTestId("composer-field").or(p.locator('[data-testid="composer"] textarea')).or(p.locator('[data-testid="composer"] [contenteditable="true"]')).first();

test("owner walk kit: the stand-in names what was asked and a LONG ask runs long", () => {
  assert.match(replyFor("plan the launch"), /plan the launch/);
  assert.ok(replyFor("LONG please").split(" ").length > 300);
});
