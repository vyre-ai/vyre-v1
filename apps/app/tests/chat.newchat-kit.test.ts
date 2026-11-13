// @tsx
// The kit of the new-chat speed walks (chat.newchat-loopback / -relay / -failed .live.test.ts): the relay, the page's stopwatch, the walk and the numbers.
// A first message in a new chat feels instant, on any network (owner, 13 Nov 2026: "it takes a long time for a new message typed from a new tab to start a chat, a good few seconds, and you can feel it").
// The production export, a fresh claimed Team Space, the real engine with a stand-in for the model vendor, and a relay between the page and the daemon that adds the delay of a Space reached over the internet:
// each way every request and every chunk waits LATENCY ms, and the first byte of the chat.start answer waits START_DELAY ms more (the relay is a small http and tcp proxy in this file, nothing else in the
// path changes). From the key press on, the page notes when (a) the person's own message is on screen in a message row, (b) the selected tab is named for the chat, (c) a working mark is on screen,
// (d) the agent's first words are on screen, and every /v1 request it makes. The budget: (a), (b) and (c) within 100 ms of the key press, on loopback and with the delay (V1-SPEC speed budgets, send shows < 16 ms, new chat < 100 ms).
// VYRE_NEWCHAT_RUNS sets the runs per case (default 5; the lane's measurement used 10). VYRE_NEWCHAT_OUT names a directory for the numbers and the shots.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { guardCrashes } from "./crash-guard.ts";
import { vendor } from "../../../fixtures/model-vendor.ts";

const PRELOAD = fileURLToPath(new URL("../../../fixtures/model-vendor-preload.mjs", import.meta.url));
const KEY = "sk-test-fixture-0123456789abcdef"; // secret-scan: fake
const RUNS = Number(process.env["VYRE_NEWCHAT_RUNS"] ?? 5);
const BUDGET_MS = 100;

export interface Relay { url: string; failChatStart: { drop: number; refuse: number }; starts: number; close(): void }

/** A relay in front of the daemon: every request waits `latency` ms before it goes on and every answer chunk waits `latency` ms before it comes back; the first byte of chat.start waits `startDelay` ms more. */
export async function relayTo(daemon: string, latency: number, startDelay: number): Promise<Relay> {
  const target = new URL(daemon);
  const wait = (ms: number): Promise<void> => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
  const relay: Relay = { url: "", failChatStart: { drop: 0, refuse: 0 }, starts: 0, close: () => undefined };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      void (async () => {
        await wait(latency);
        const start = String(req.url).startsWith("/v1/chat/start");
        if (start) relay.starts += 1;
        if (start && relay.failChatStart.refuse > 0) { relay.failChatStart.refuse -= 1; await wait(latency); res.writeHead(503); res.end("relay refused"); return; }
        const dropAnswer = start && relay.failChatStart.drop > 0;
        if (dropAnswer) relay.failChatStart.drop -= 1;
        const up = http.request({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers: req.headers }, (r) => {
          if (dropAnswer) { r.resume(); void wait(latency).then(() => { res.writeHead(502); res.end("answer lost"); }); return; }
          void (async () => {
            // one way back: the answer (head and body together) arrives `latency` ms after the daemon sent it, so a call costs 2 x latency, as on a link with that delay each way
            await wait(latency + (start ? startDelay : 0));
            res.writeHead(r.statusCode ?? 502, r.headers);
            r.pipe(res);
          })();
        });
        up.on("error", () => { res.writeHead(502); res.end("daemon unreachable"); });
        up.end(Buffer.concat(chunks));
      })();
    });
  });
  // a connection the edge keeps for the next request stays open: node's default would close an idle one after 5 s, and the next request on it would fail as a reset
  server.keepAliveTimeout = 120_000; server.requestTimeout = 0; server.headersTimeout = 0;
  server.on("clientError", (_e, socket) => { socket.destroy(); });
  server.on("upgrade", (req, socket, head) => {
    const up = net.connect(Number(target.port), target.hostname, () => {
      const lines = [`${req.method ?? "GET"} ${req.url ?? "/"} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      const send = (to: net.Socket, b: Buffer): void => { void wait(latency).then(() => { if (!to.destroyed) to.write(b); }); };
      send(up, Buffer.from(`${lines.join("\r\n")}\r\n\r\n`));
      if (head.length) send(up, head);
      socket.on("data", (b: Buffer) => send(up, b));
      up.on("data", (b: Buffer) => send(socket, b));
    });
    up.on("error", () => socket.destroy());
    up.on("close", () => socket.destroy());
    socket.on("error", () => up.destroy());
    socket.on("close", () => up.destroy());
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  relay.url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  relay.close = () => { server.close(); server.closeAllConnections(); };
  return relay;
}

/** The page's own stopwatch: started by the Enter key press, it notes the first time each thing is on screen. Installed before the page's scripts run. */
const RECORDER = `(() => {
  const S = (window.__nc = { armed: false, t0: 0, marker: "", words: "", reply: "", marks: {}, reqs: [], tabs: [], tab0: "" });
  const first = window.fetch.bind(window);
  S.pending = 0;
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (String(url).includes("/v1/")) {
      S.pending += 1;
      const rec = S.t0 ? { cap: String(url).split("/v1/")[1], s: performance.now() - S.t0, h: null } : null;
      if (rec) S.reqs.push(rec);
      const p = first(input, init);
      const done = () => { S.pending -= 1; };
      p.then((r) => { done(); if (rec) rec.h = performance.now() - S.t0; return r; }, done);
      return p;
    }
    return first(input, init);
  };
  const NativeWS = window.WebSocket;
  window.WebSocket = new Proxy(NativeWS, { construct(target, args) { const ws = new target(...args); ws.addEventListener("message", (e) => { if (S.t0 && S.wsAt === undefined && S.reply && typeof e.data === "string" && e.data.includes(S.reply.slice(0, 12))) S.wsAt = performance.now() - S.t0; }); return ws; } });
  addEventListener("keydown", (e) => { if (e.key === "Enter" && S.armed && !S.t0) { S.t0 = performance.now(); S.wall0 = Date.now(); S.tab0 = (document.querySelector('[data-testid^="tab-"][data-testid$="-selected"]') || {}).textContent || ""; } }, true);
  const look = () => {
    if (!S.t0) return;
    const now = performance.now() - S.t0, m = S.marks;
    if (m.a === undefined) { for (const el of document.querySelectorAll('[data-testid^="msg-"]')) if ((el.textContent || "").includes(S.marker)) { m.a = now; requestAnimationFrame(() => { m.aPaint = performance.now() - S.t0; }); break; } }
    const tab = document.querySelector('[data-testid^="tab-"][data-testid$="-selected"]'), tabText = tab ? (tab.textContent || "") : "";
    if (S.tabs.length === 0 || S.tabs[S.tabs.length - 1].text !== tabText) S.tabs.push({ at: Math.round(now), text: tabText });
    if (m.b === undefined && tab && tabText.includes(S.words)) m.b = now;
    if (m.c === undefined && document.querySelector('[data-testid="working-mark"],[data-testid="conversation-live"]')) m.c = now;
    if (m.d === undefined && m.a !== undefined && document.body.textContent.includes(S.reply.split(" ")[0])) m.d = now;
  };
  const watch = () => { if (document.documentElement) new MutationObserver(look).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true }); else setTimeout(watch, 5); };
  watch();
  const tick = () => { look(); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
})();`;

export const pct = (xs: number[], p: number): number | null => { if (xs.length === 0) return null; const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.max(0, Math.ceil(p * s.length) - 1)]!); };

interface Marks { a?: number; aPaint?: number; b?: number; c?: number; d?: number }
interface RunOut { marks: Marks; reqs: { cap: string; s: number; h: number | null }[]; tabs: { at: number; text: string }[]; vendorMs?: number; wsAt?: number }

export async function walk(label: string, latency: number, startDelay: number, body: (ctx: { page: any; web: { origin: string }; relay: Relay; api: (cap: string, data: unknown) => Promise<any>; v: Awaited<ReturnType<typeof vendor>>; shots: string; guard: ReturnType<typeof guardCrashes> }) => Promise<void>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const dist = process.env["VYRE_APP_DIST"];
  assert.ok(dist, "VYRE_APP_DIST required");
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  assert.ok(fs.existsSync(exe), `Chromium is required at ${exe}`);
  const v = await vendor();
  const priorOptions = process.env["NODE_OPTIONS"];
  process.env["NODE_OPTIONS"] = `${priorOptions ?? ""} --import ${PRELOAD}`.trim();
  process.env["VYRE_TEST_VENDOR"] = v.base;
  const space = await bootFreshSpace(undefined, true);
  if (priorOptions === undefined) delete process.env["NODE_OPTIONS"]; else process.env["NODE_OPTIONS"] = priorOptions;
  const relay = await relayTo(space.url, latency, startDelay);
  const web = await edge(dist, relay.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  let direct: Awaited<ReturnType<typeof edge>> | null = null;
  const guard = guardCrashes(page);
  const shots = process.env["VYRE_NEWCHAT_OUT"] ?? "/tmp/vyre-newchat"; fs.mkdirSync(shots, { recursive: true });
  try {
    // signing in and setting up go straight to the daemon: only the walk under test pays the delay
    const d = await edge(dist, space.url); direct = d;
    await page.goto(claimOnEdge(space.claim!, d.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Chat Owner"); await page.getByTestId("claim-username").fill("chatowner");
    await page.getByTestId("claim-password").fill("fixture password 123"); await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click(); await dismissOnboarding(page);
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string);
    const api = async (cap: string, data: unknown): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await context.request.post(`${d.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data });
      assert.equal(r.status(), 200, `${cap}: ${await r.text()}`); return (await r.json()).data;
    };
    const provider = await api("providers.add", { idempotencyKey: "nc-provider", providerKey: "openai", connection: "api_key", apiKey: KEY, scope: "mine" });
    await api("providers.set_space_use", { idempotencyKey: "nc-spaceuse", providerId: provider.provider.id, allow: true });
    const assistant = (await api("agents.list", {})).agents[0] as { agentId: string };
    await api("agents.update", { agentId: assistant.agentId, patch: { model: "gpt-4o-mini" }, idempotencyKey: "nc-model" });
    // the session the page holds belongs to the direct origin; the walk's page reopens on the relayed one with the same session
    const session = await page.evaluate(() => localStorage.getItem("vyre.session.v1")!);
    const swapped = session.replaceAll(d.origin, web.origin);
    const walkPage = await context.newPage();
    await walkPage.addInitScript((s: string) => { try { if (!localStorage.getItem("vyre.session.v1")) localStorage.setItem("vyre.session.v1", s); } catch { /* none */ } }, swapped);
    await walkPage.addInitScript(RECORDER);
    // VYRE_NEWCHAT_MUX=1: the other bound. The page's /v1 calls skip the browser's six-connections-per-origin queue (as on a multiplexed link) and each still pays `latency` each way; only the live socket goes through the relay.
    if (process.env["VYRE_NEWCHAT_MUX"] === "1") {
      await walkPage.route("**/v1/**", async (route: any) => { try { // eslint-disable-line @typescript-eslint/no-explicit-any
        const req = route.request(); const u = new URL(req.url());
        const start = u.pathname.startsWith("/v1/chat/start");
        if (start) relay.starts += 1;
        await new Promise((r) => setTimeout(r, latency));
        const headers: Record<string, string> = {}; for (const [k, val] of Object.entries(req.headers() as Record<string, string>)) if (!["host", "content-length", "connection"].includes(k)) headers[k] = val;
        const up = await fetch(`${space.url}${u.pathname}${u.search}`, { method: req.method(), headers, ...(req.method() === "GET" || req.method() === "HEAD" ? {} : { body: req.postDataBuffer() }) });
        const body = Buffer.from(await up.arrayBuffer());
        await new Promise((r) => setTimeout(r, latency + (start ? startDelay : 0)));
        const out: Record<string, string> = {}; up.headers.forEach((val, k) => { if (!["content-encoding", "transfer-encoding", "content-length", "connection"].includes(k)) out[k] = val; });
        await route.fulfill({ status: up.status, headers: out, body });
      } catch { /* the page or the daemon is gone: the walk is over */ } });
    }
    await page.close();
    await body({ page: walkPage, web, relay, api, v, shots, guard: guardCrashes(walkPage) });
    void guard;
  } finally { await browser.close(); web.close(); direct?.close(); relay.close(); await space.stop(); v.close(); }
}

/** Opens the first screen of Chats, types `text` and presses Enter. Returns the page's own record of what appeared when. */
export async function sendNew(page: any, v: Awaited<ReturnType<typeof vendor>>, text: string, reply: string, o: { shot?: string; settle?: boolean } = {}): Promise<RunOut> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const field = page.getByTestId("composer-field").first();
  await field.waitFor({ timeout: 30_000 });
  // the page finishes its first reads (the Assistant, the last model pick, the lists under the composer) before the key press, as a person's does: this is a short settle, not a wait for a result
  await page.waitForTimeout(1000);
  v.script.push({ text: reply });
  const words = text.split(/\s+/).slice(0, 6).join(" ");
  await page.evaluate((a: { marker: string; words: string; reply: string }) => { const S = (window as any).__nc; S.marker = a.marker; S.words = a.words; S.reply = a.reply; S.armed = true; }, { marker: text, words, reply }); // eslint-disable-line @typescript-eslint/no-explicit-any
  await field.fill(text);
  // when the model vendor's stand-in first hears of the turn (the same computer's clock as the page's): the server's share of the time to the first word
  const heard = v.requests.length;
  let vendorAt = 0;
  const poll = (async () => { const end = Date.now() + 25_000; while (vendorAt === 0 && Date.now() < end) { if (v.requests.length > heard) vendorAt = Date.now(); else await new Promise((r) => setTimeout(r, 5)); } })();
  await field.press("Enter");
  if (o.shot) { await page.waitForTimeout(200); await page.screenshot({ path: o.shot }); }
  await page.waitForFunction(() => { const m = (window as any).__nc.marks; return m.a !== undefined && m.b !== undefined && m.c !== undefined && m.d !== undefined; }, undefined, { timeout: 25_000 }).catch(() => undefined); // eslint-disable-line @typescript-eslint/no-explicit-any
  await poll;
  const out = await page.evaluate(() => { const S = (window as any).__nc; return { marks: S.marks, reqs: S.reqs, tabs: S.tabs, wall0: S.wall0 as number, wsAt: S.wsAt as number | undefined }; }); // eslint-disable-line @typescript-eslint/no-explicit-any
  return { marks: out.marks, reqs: out.reqs, tabs: out.tabs, ...(vendorAt > 0 ? { vendorMs: vendorAt - out.wall0 } : {}), ...(out.wsAt !== undefined ? { wsAt: out.wsAt } : {}) };
}

export async function runCase(label: string, latency: number, startDelay: number): Promise<{ a: number[]; aPaint: number[]; b: number[]; c: number[]; d: number[]; vendor: number[]; tokenLag: number[]; missing: string[] }> {
  const got = { a: [] as number[], aPaint: [] as number[], b: [] as number[], c: [] as number[], d: [] as number[], vendor: [] as number[], tokenLag: [] as number[], missing: [] as string[] };
  const out = process.env["VYRE_NEWCHAT_OUT"] ?? "/tmp/vyre-newchat";
  await walk(label, latency, startDelay, async ({ page, web, v, guard }) => {
    for (let i = 1; i <= RUNS; i++) {
      await page.goto(`${web.origin}/chat`, { waitUntil: "load" });
      const text = `Plan the quarterly review number ${i} for the Lisbon team ${Math.random().toString(36).slice(2, 8)}`;
      const reply = `w${Math.random().toString(36).slice(2, 8)} is the plan ${i}`;
      const r = await sendNew(page, v, text, reply, i === 1 ? { shot: path.join(out, `${label}-200ms.png`) } : {});
      await guard.check(`${label} run ${i}`);
      for (const k of ["a", "aPaint", "b", "c", "d"] as const) { const x = r.marks[k]; if (x === undefined) got.missing.push(`run ${i}: ${k}`); else got[k].push(x); }
      if (r.vendorMs !== undefined) got.vendor.push(r.vendorMs);
      if (r.wsAt !== undefined && r.marks.d !== undefined) got.tokenLag.push(r.marks.d - r.wsAt);
      if (i === 1) fs.writeFileSync(path.join(out, `${label}-tab-names.json`), JSON.stringify(r.tabs, null, 1));
      if (i === 1) fs.writeFileSync(path.join(out, `${label}-requests.json`), JSON.stringify(r.reqs.map((q) => ({ cap: q.cap, startMs: Math.round(q.s), headersMs: q.h === null ? null : Math.round(q.h) })), null, 1));
    }
  });
  const row = { case: label, latencyMs: latency, startDelayMs: startDelay, runs: RUNS, message_visible_ms: { p50: pct(got.a, 0.5), p95: pct(got.a, 0.95) }, message_painted_ms: { p50: pct(got.aPaint, 0.5), p95: pct(got.aPaint, 0.95) }, tab_named_ms: { p50: pct(got.b, 0.5), p95: pct(got.b, 0.95) }, working_shown_ms: { p50: pct(got.c, 0.5), p95: pct(got.c, 0.95) }, first_token_ms: { p50: pct(got.d, 0.5), p95: pct(got.d, 0.95) }, model_asked_ms: { p50: pct(got.vendor, 0.5), p95: pct(got.vendor, 0.95) }, token_after_frame_ms: { p50: pct(got.tokenLag, 0.5), p95: pct(got.tokenLag, 0.95) }, missing: got.missing };
  console.log("METRIC " + JSON.stringify({ name: "new_chat_first_message", ...row, budget_ms: BUDGET_MS }));
  fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, `${label}.json`), JSON.stringify(row, null, 1));
  return got;
}

/** The same numbers for a chat that opens from a link with a first message of its own (Home's Ask, a task, a project, an agent: `screen=chats.ask&with=assistant&first=...`). The stopwatch starts when the link is followed. */
export async function runAskCase(label: string, latency: number, startDelay: number): Promise<ReturnType<typeof newGot>> {
  const got = newGot();
  const starts: number[] = [];
  const out = process.env["VYRE_NEWCHAT_OUT"] ?? "/tmp/vyre-newchat";
  await walk(label, latency, startDelay, async ({ page, web, v, guard, relay }) => {
    for (let i = 1; i <= RUNS; i++) {
      const before = relay.starts;
      await page.goto(`${web.origin}/chat`, { waitUntil: "load" });
      await page.getByTestId("composer-field").first().waitFor({ timeout: 30_000 }).catch(async (e: unknown) => { await page.screenshot({ path: path.join(out, `${label}-stuck-${i}.png`) }); throw e; });
      await page.waitForTimeout(1000);
      const text = `Summarise the open tasks number ${i} for the Lisbon team ${Math.random().toString(36).slice(2, 8)}`;
      const reply = `w${Math.random().toString(36).slice(2, 8)} is the summary ${i}`;
      v.script.push({ text: reply });
      await page.evaluate((a: { marker: string; words: string; reply: string; hash: string }) => { const S = (window as any).__nc; S.marker = a.marker; S.words = a.words; S.reply = a.reply; S.armed = true; S.t0 = performance.now(); S.wall0 = Date.now(); location.hash = a.hash; }, { marker: text, words: text.split(/\s+/).slice(0, 6).join(" "), reply, hash: `screen=chats.ask&with=assistant&first=${encodeURIComponent(text)}` }); // eslint-disable-line @typescript-eslint/no-explicit-any
      await page.waitForFunction(() => { const m = (window as any).__nc.marks; return m.a !== undefined && m.b !== undefined && m.c !== undefined && m.d !== undefined; }, undefined, { timeout: 25_000 }).catch(() => undefined); // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await page.evaluate(() => { const S = (window as any).__nc; return { marks: S.marks, reqs: S.reqs }; }); // eslint-disable-line @typescript-eslint/no-explicit-any
      starts.push(relay.starts - before);
      console.log(`${label} run ${i}: chat.start went to the server ${relay.starts - before} time(s)`);
      await guard.check(`${label} run ${i}`);
      for (const k of ["a", "aPaint", "b", "c", "d"] as const) { const x = (r.marks as Marks)[k]; if (x === undefined) got.missing.push(`run ${i}: ${k}`); else got[k].push(x); }
    }
  });
  const row = { case: label, latencyMs: latency, startDelayMs: startDelay, runs: RUNS, message_visible_ms: { p50: pct(got.a, 0.5), p95: pct(got.a, 0.95) }, tab_named_ms: { p50: pct(got.b, 0.5), p95: pct(got.b, 0.95) }, working_shown_ms: { p50: pct(got.c, 0.5), p95: pct(got.c, 0.95) }, first_token_ms: { p50: pct(got.d, 0.5), p95: pct(got.d, 0.95) }, missing: got.missing };
  console.log("METRIC " + JSON.stringify({ name: "ask_first_message", ...row, chat_start_calls_per_run: starts, budget_ms: BUDGET_MS }));
  fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, `${label}.json`), JSON.stringify(row, null, 1));
  return got;
}

const newGot = () => ({ a: [] as number[], aPaint: [] as number[], b: [] as number[], c: [] as number[], d: [] as number[], vendor: [] as number[], missing: [] as string[] });

/** Opens an existing chat by its link and records every /v1 request from the link until its last message is on screen, in order, with when each started and when its headers came back. */
export async function runOpenCase(label: string, latency: number, startDelay: number): Promise<{ first: number[]; table: { cap: string; startMs: number; headersMs: number | null }[] }> {
  const out = process.env["VYRE_NEWCHAT_OUT"] ?? "/tmp/vyre-newchat";
  const firsts: number[] = [];
  let table: { cap: string; startMs: number; headersMs: number | null }[] = [];
  await walk(label, latency, startDelay, async ({ page, web, api, v }) => {
    const assistant = (await api("agents.list", {})).agents[0] as { agentId: string };
    for (let i = 1; i <= RUNS; i++) {
      const word = `Open chat number ${i} ${Math.random().toString(36).slice(2, 8)}`;
      const tag = `w${Math.random().toString(36).slice(2, 8)}`; v.script.push({ text: `${tag} replied` });
      const made = await api("chat.start", { kind: "chat", agentIds: [assistant.agentId], first: word, title: word, idempotencyKey: `open-${label}-${i}-${word}` });
      const id = made.thread.threadId as string;
      for (let k = 0; k < 100; k++) { const m = (await api("chat.messages.list", { threadId: id, limit: 10 })).messages as unknown[]; if (m.length >= 2) break; await new Promise((r) => setTimeout(r, 100)); }
      await page.goto(`${web.origin}/chat`, { waitUntil: "load" });
      await page.getByTestId("composer-field").first().waitFor({ timeout: 30_000 });
      // quiet: nothing of the first screen's own reads is still out when the link is followed, however slow the link is
      await page.waitForFunction(() => (window as any).__nc.pending === 0, undefined, { timeout: 60_000 }); // eslint-disable-line @typescript-eslint/no-explicit-any
      await page.waitForTimeout(700);
      await page.evaluate((a: { marker: string; tag: string; hash: string }) => { const S = (window as any).__nc; S.marker = a.marker; S.words = a.marker; S.reply = a.tag + " replied"; S.armed = true; S.t0 = performance.now(); S.wall0 = Date.now(); location.hash = a.hash; }, { marker: word, tag, hash: `subject=thread:${id}` }); // eslint-disable-line @typescript-eslint/no-explicit-any
      await page.waitForFunction(() => (window as any).__nc.marks.d !== undefined, undefined, { timeout: 30_000 }).catch(() => undefined); // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await page.evaluate(() => { const S = (window as any).__nc; return { marks: S.marks, reqs: S.reqs }; }); // eslint-disable-line @typescript-eslint/no-explicit-any
      const seen = (r.marks as Marks).d ?? (r.marks as Marks).a;
      if (seen !== undefined) firsts.push(seen);
      if (i === 1) table = (r.reqs as { cap: string; s: number; h: number | null }[]).map((q) => ({ cap: q.cap, startMs: Math.round(q.s), headersMs: q.h === null ? null : Math.round(q.h) }));
    }
  });
  const row = { case: label, latencyMs: latency, runs: RUNS, last_messages_painted_ms: { p50: pct(firsts, 0.5), p95: pct(firsts, 0.95) }, requests_before_paint_in_run_1: table.length };
  console.log("METRIC " + JSON.stringify({ name: "open_existing_chat", ...row }));
  fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, `${label}.json`), JSON.stringify({ ...row, table }, null, 1));
  return { first: firsts, table };
}

/** The agent's first words are on screen within `budget` ms of reaching the page (the live frame), whatever else is loading. */
export function tokenWithin(label: string, got: { tokenLag: number[] }, budget = 300): void {
  assert.ok(got.tokenLag.length > 0, `${label}: the page saw the first words arrive`);
  assert.ok((pct(got.tokenLag, 0.95) ?? Infinity) <= budget, `${label}: the first words are on screen within ${budget} ms of reaching the page (p95 ${pct(got.tokenLag, 0.95)} ms, p50 ${pct(got.tokenLag, 0.5)} ms)`);
}

export function within(label: string, got: { a: number[]; aPaint: number[]; b: number[]; c: number[]; missing: string[] }, budget = BUDGET_MS): void {
  assert.deepEqual(got.missing.filter((m) => !m.endsWith(": d")), [], `${label}: every mark appeared`);
  assert.ok((pct(got.a, 0.95) ?? Infinity) <= budget, `${label}: his own message is on screen within ${budget} ms of the key press (p95 ${pct(got.a, 0.95)} ms, p50 ${pct(got.a, 0.5)} ms)`);
  assert.ok((pct(got.b, 0.95) ?? Infinity) <= budget, `${label}: the tab is the chat within ${budget} ms (p95 ${pct(got.b, 0.95)} ms)`);
  assert.ok((pct(got.c, 0.95) ?? Infinity) <= budget, `${label}: the working mark is on screen within ${budget} ms (p95 ${pct(got.c, 0.95)} ms)`);
}

test("new chat kit: the percentile of ten runs is the slowest run (nearest rank), and an empty list has none", () => {
  assert.equal(pct([5, 1, 9, 3, 2, 8, 7, 4, 6, 10], 0.95), 10);
  assert.equal(pct([5, 1, 9, 3, 2, 8, 7, 4, 6, 10], 0.5), 5);
  assert.equal(pct([], 0.5), null);
});
