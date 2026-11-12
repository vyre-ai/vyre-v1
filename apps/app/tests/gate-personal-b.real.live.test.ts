// @tsx
// Release gate, part B, Personal Space (12 Nov 2026): chat with a real model (OpenCode Go, the cheap default) in the production web export, driven by headless Chrome against a real daemon.
// First token, streaming, a second message while one streams, Stop, a long reply, reload and a daemon restart mid-stream, markdown, a bad key, an unreachable host. Skips without OPENCODE_API_KEY.
// Timing rows and shots go to VYRE_GATE_SHOTS/b-personal. Nothing here prints the key.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { guardCrashes } from "./crash-guard.ts";
import { GATE_MODEL, REAL_KEY, bootGate, claimInBrowser, gateSkip, recorder, tokenOf, unreachablePreload } from "./gate-kit.test.ts";

const PASSWORD = "gate walk password 4417";
type Msg = { author: { kind: string; id: string }; body: string; createdAt?: number; blocks?: Array<{ type: string; state?: string; data?: Record<string, unknown> }>; messageId?: string; id?: string };

test("GATE B (Personal Space): chat with a real model", { skip: gateSkip(), timeout: 1_500_000 }, async () => {
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  assert.ok(fs.existsSync(exe), `Chromium is required at ${exe}`);
  const shots = path.join(process.env["VYRE_GATE_SHOTS"] ?? "/tmp/vyre-gate-shots", "b-personal"); fs.mkdirSync(shots, { recursive: true });
  const rec = recorder(shots, "rows.json");
  const d = await bootGate("personal", "Gate Personal");
  const web = await edge(process.env["VYRE_APP_DIST"]!, d.address);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const failures: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await context.newPage();
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
    const guard = guardCrashes(page);
    const shot = async (name: string): Promise<string> => { await page.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))").catch(() => undefined); await page.screenshot({ path: path.join(shots, `${name}.png`) }).catch(() => undefined); return `${name}.png`; };
    const body = async (): Promise<string> => ((await page.evaluate("document.body.innerText").catch(() => "")) as string).replace(/\n+/g, " | ");
    const only = (process.env["GATE_B_ONLY"] ?? "").split(",").filter(Boolean);
    const step = async (section: string, name: string, f: () => Promise<Partial<{ result: string; ms: number; shot: string; note: string }> | void>): Promise<void> => {
      const t0 = Date.now();
      if (only.length > 0 && !only.some((n) => name.includes(n)) && !name.startsWith("new chat")) return;
      try { const r = (await f()) ?? {}; rec.add({ section, step: name, result: r.result ?? "ok", ...(r.ms !== undefined ? { ms: r.ms } : {}), ...(r.shot ? { shot: r.shot } : {}), ...(r.note ? { note: r.note } : {}) }); }
      catch (e) { const msg = (e as Error).message.split("\n")[0]!.slice(0, 300); failures.push(`${name}: ${msg}`); rec.add({ section, step: name, result: `FAIL ${msg}`, ms: Date.now() - t0, shot: await shot(`fail-${failures.length}`), note: (await body()).slice(0, 300) }); }
    };

    // claim and the model, the way a person ends up with one: the key goes in through the API (the Settings screen for it is walked in part A)
    await claimInBrowser(page, d.claim!.replace(d.address, web.origin), { name: "Gate Owner", username: "gateowner", password: PASSWORD });
    await dismissOnboarding(page);
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await tokenOf(page);
    const api = async (cap: string, data: unknown = {}, expect = 200): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await context.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data: { idempotencyKey: `g-${cap}-${Math.random().toString(36).slice(2)}`, ...(data as object) } });
      const j = (await r.json().catch(() => ({}))) as { data?: unknown };
      if (expect && r.status() !== expect) throw new Error(`${cap}: ${r.status()} ${JSON.stringify(j).replaceAll(REAL_KEY, "***").slice(0, 300)}`);
      return j.data;
    };
    const prov = await api("providers.add", { providerKey: "opencode-go", connection: "api_key", apiKey: REAL_KEY, scope: "mine" });
    assert.ok(prov.provider.id);
    const assistant = (await api("agents.list")).agents[0] as { agentId: string };
    await api("agents.update", { agentId: assistant.agentId, patch: { model: GATE_MODEL } });
    await page.reload({ waitUntil: "load" }); await page.getByTestId("shell").waitFor({ timeout: 30_000 });

    const field = page.getByTestId("composer-field").first();
    const threads = async (): Promise<Array<{ threadId: string; title?: string }>> => ((await api("threads.list", {})).threads ?? []) as Array<{ threadId: string; title?: string }>;
    const messages = async (threadId: string): Promise<Msg[]> => ((await api("chat.messages.list", { threadId })).messages ?? []) as Msg[];
    const agentMsgs = (ms: Msg[]): Msg[] => ms.filter((m) => m.author.kind === "agent");
    const emptyState = /What are we working on\?/;

    /** Press Enter in the composer and watch the screen the way a person feels it: user line shown, first sign of life, first reply text, done. */
    const turn = async (text: string, o: { limitMs?: number; sampleShotAt?: number[]; tag: string; waitDone?: boolean } = { tag: "t" }): Promise<{ opened: number; firstSign: number; firstText: number; done: number; user: number; series: number[]; flash: boolean; shrinks: number; reply: string }> => {
      const before = await body();
      await field.fill(text);
      const t0 = Date.now();
      await field.press("Enter");
      let user = -1, firstSign = -1, firstText = -1, done = -1, flash = false, shrinks = 0, last = before.length, opened = -1; const series: number[] = []; let shotsTaken = 0;
      const lim = o.limitMs ?? 120_000; let reply = "";
      for (;;) {
        const now = Date.now() - t0; if (now > lim) break;
        const b = await body();
        series.push(b.length);
        const wasOpen = opened >= 0;
        if (opened < 0 && !emptyState.test(b) && b.includes(text.slice(0, 20))) { opened = now; user = now; }
        if (wasOpen && emptyState.test(b)) flash = true;
        if (b.length < last - 3) shrinks++;
        last = b.length;
        const stopShown = await page.getByTestId("stop-button").first().isVisible().catch(() => false);
        if (firstSign < 0 && user >= 0 && (stopShown || b.length > before.length + text.length + 4)) firstSign = now;
        if (o.sampleShotAt && shotsTaken < o.sampleShotAt.length && now >= o.sampleShotAt[shotsTaken]!) { await shot(`${o.tag}-s${shotsTaken}`); shotsTaken++; }
        const ms = await threadsMsgs();
        reply = agentMsgs(ms).at(-1)?.body ?? "";
        if (firstText < 0 && reply.trim().length > 0 && b.includes(reply.trim().slice(0, 12))) firstText = now;
        if (user >= 0 && !stopShown && reply.trim().length > 0 && firstText >= 0) { done = now; break; }
        await page.waitForTimeout(80);
      }
      return { firstSign, firstText, done, user, series, flash, shrinks, reply, opened };
    };
    let thread = "";
    const threadsMsgs = async (): Promise<Msg[]> => { if (!thread) { const t = await threads(); if (t[0]) thread = t[0].threadId; } return thread ? messages(thread) : []; };

    await step("B", "new chat with the Assistant, a short message", async () => {
      const r = await turn("Reply with one short friendly sentence about tea.", { tag: "b01", sampleShotAt: [1500, 4000] });
      await shot("b01-done");
      assert.ok(r.done >= 0, "the turn finished within the limit");
      assert.ok(!r.flash, "the empty state did not flash after sending");
      return { ms: r.done, note: `chat opened with the user line at ${r.opened} ms, first sign ${r.firstSign} ms, first text ${r.firstText} ms, done ${r.done} ms, page-text shrinks ${r.shrinks}, reply: ${r.reply.slice(0, 120)}` };
    });
    await guard.check("after the first turn");
    const tl = await threads();
    rec.add({ section: "B", step: "chat list and title after the first exchange", result: `${tl.length} chat(s)`, shot: await shot("b02-list"), note: `title: ${JSON.stringify(tl[0]?.title)}` });

    const stopVisible = (): Promise<boolean> => page.getByTestId("stop-button").first().isVisible().catch(() => false);
    const liveTurns = async (): Promise<boolean> => { if (!thread) await threadsMsgs(); if (!thread) return false; const turns = ((await api("engine.turns.list", { threadId: thread }).catch(() => ({ turns: [] }))).turns ?? []) as Array<{ state: string }>; return turns.some((x) => x.state === "running" || x.state === "queued"); };
    const waitIdle = async (ms = 120_000): Promise<number> => { const t0 = Date.now(); for (;;) { if (Date.now() - t0 > ms) throw new Error("the chat stayed busy"); if (!(await liveTurns()) && !(await stopVisible())) return Date.now() - t0; await page.waitForTimeout(150); } };
    let sentBodyLen = 0;
    const waitFirstText = async (n: number, ms = 180_000): Promise<number> => { const t0 = Date.now(); for (;;) { if (Date.now() - t0 > ms) throw new Error("no reply text came"); const b = await body(); if (b.length > sentBodyLen + 400 && (await liveTurns())) return Date.now() - t0; const a = agentMsgs(await threadsMsgs()); if (a.length >= n && a[n - 1]!.body.trim() !== "") return Date.now() - t0; await page.waitForTimeout(100); } };
    const scroller = (): Promise<{ top: number; max: number; client: number } | null> => page.evaluate(() => {
      let best: HTMLElement | null = null;
      for (const e of Array.from(document.querySelectorAll<HTMLElement>("*"))) { const o = getComputedStyle(e).overflowY; if ((o === "auto" || o === "scroll") && e.scrollHeight > e.clientHeight + 20 && e.clientWidth > 400 && (!best || e.scrollHeight > best.scrollHeight)) best = e; }
      return best ? { top: best.scrollTop, max: best.scrollHeight, client: best.clientHeight } : null;
    });
    const scrollBy = (dy: number): Promise<void> => page.evaluate((y) => { let best: HTMLElement | null = null; for (const e of Array.from(document.querySelectorAll<HTMLElement>("*"))) { const o = getComputedStyle(e).overflowY; if ((o === "auto" || o === "scroll") && e.scrollHeight > e.clientHeight + 20 && e.clientWidth > 400 && (!best || e.scrollHeight > best.scrollHeight)) best = e; } if (best) best.scrollTop += y; }, dy);
    const nMsgs = async (): Promise<number> => (await threadsMsgs()).length;
    const send = async (text: string, o: { queue?: boolean } = {}): Promise<number> => { if (!o.queue) await waitIdle(180_000).catch(() => undefined); sentBodyLen = (await body()).length; await field.fill(text); const t = Date.now(); await field.press("Enter"); return t; };

    // second message while the first is still streaming (queued)
    await step("B", "a second message while the first streams (queued)", async () => {
      const a0 = agentMsgs(await threadsMsgs()).length;
      await send("Write 250 numbered lines, each one a different short fact about the ocean. Nothing else.");
      await waitFirstText(a0 + 1);
      await page.waitForTimeout(600);
      const t = await send("Then say the single word BLUE on its own line.", { queue: true });
      await page.waitForTimeout(900);
      const queued = await page.getByTestId("queue-row").count();
      const s1 = await shot("b03-queued");
      const idle1 = await waitIdle();
      await page.waitForTimeout(1500);
      // the queued message runs next; wait until it has an answer
      const end = Date.now(); let ms2: Msg[] = [];
      for (;;) { ms2 = await threadsMsgs(); const users = ms2.filter((m) => m.author.kind !== "agent"); if (users.length >= 3 && agentMsgs(ms2).length >= a0 + 2 && !(await stopVisible())) break; if (Date.now() - end > 90_000) throw new Error("the queued message never got its answer"); await page.waitForTimeout(300); }
      const s2 = await shot("b04-after-queued");
      const order = ms2.map((m) => (m.author.kind === "agent" ? "A" : "U")).join("");
      assert.ok(order.endsWith("AA") && (order.match(/U/g) ?? []).length >= 3, `both messages were answered, the queued one after the first: ${order}`);
      return { result: `queue rows seen ${queued}; order ${order}`, ms: Date.now() - t, shot: `${s1}, ${s2}`, note: `first answer idle after ${idle1} ms; second message answered: ${agentMsgs(ms2).at(-1)!.body.slice(0, 80).replace(/\n/g, " / ")}` };
    });
    await guard.check("after the queued message");

    // Stop mid-stream: the partial reply stays, nothing stuck, the next message works
    await step("B", "Stop a reply mid-stream", async () => {
      const n0 = agentMsgs(await threadsMsgs()).length;
      await send("Write 300 numbered lines, each a different short fact about rivers. Nothing else.");
      await waitFirstText(n0 + 1);
      await page.waitForTimeout(1800);
      const tStop = Date.now();
      await page.getByTestId("stop-button").first().click({ force: true, timeout: 5000 });
      let idle = -1;
      for (let i = 0; i < 100; i++) { if (!(await stopVisible())) { idle = Date.now() - tStop; break; } await page.waitForTimeout(100); }
      await page.waitForTimeout(800);
      const partial = agentMsgs(await threadsMsgs()).at(-1)!.body;
      const sShot = await shot("b05-stopped");
      assert.ok(idle >= 0, "Stop ended the working state");
      assert.ok(partial.trim().length > 0, "the partial reply stays");
      const stoppedWords = (await body()).match(/Stopped[^|]*/g) ?? [];
      const before = (await threadsMsgs()).length;
      const r = await turn("Say OK.", { tag: "b06", limitMs: 90_000 });
      assert.ok(r.done >= 0, "the next message works after Stop");
      return { result: "partial kept, next works", ms: idle, shot: `${sShot}`, note: `stop to idle ${idle} ms; partial ${partial.length} chars; words on screen: ${stoppedWords.join(" / ")}; next reply done in ${r.done} ms; messages ${before}` };
    });
    await guard.check("after Stop");

    // a long reply: pinned scroll, unpin on scroll up, no jump at the end
    await step("B", "a long reply: scroll stays pinned, scrolling up unpins, no jump at the end", async () => {
      const n0 = agentMsgs(await threadsMsgs()).length;
      await send("Write 150 numbered lines, each a short fact about mountains. Nothing else.");
      await waitFirstText(n0 + 1);
      const gaps: number[] = []; let pinnedSamples = 0;
      for (let i = 0; i < 14; i++) { await page.waitForTimeout(500); const sc = await scroller(); if (sc) { const gap = sc.max - sc.top - sc.client; gaps.push(gap); if (gap < 60) pinnedSamples++; } if (!(await stopVisible())) break; }
      const sPinned = await shot("b07-long-pinned");
      const sc1 = await scroller();
      await scrollBy(-500); await page.waitForTimeout(1200);
      const afterUp = await scroller();
      const stillStreaming = await stopVisible();
      await page.waitForTimeout(2500);
      const later = await scroller();
      const drift = afterUp && later ? Math.abs(later.top - afterUp.top) : -1;
      await waitIdle(120_000);
      await page.waitForTimeout(800);
      const fin = await scroller(); const sEnd = await shot("b08-long-end");
      const text = (await threadsMsgs()); const lines = (agentMsgs(text).at(-1)?.body.match(/^\s*\d+[.)]/gm) ?? []).length;
      assert.ok(gaps.length > 0, "the chat scrolls");
      return { result: `pinned ${pinnedSamples}/${gaps.length}; unpinned stayed (drift ${drift}px, streaming ${stillStreaming})`, shot: `${sPinned}, ${sEnd}`, note: `gaps ${gaps.join(",")}; at end top ${fin?.top}/${fin?.max}; ${lines} numbered lines` };
    });

    // sending while scrolled up must bring the new message into view
    await step("B", "send while scrolled up: the new message comes into view", async () => {
      await scrollBy(-1500); await page.waitForTimeout(500);
      const sc0 = await scroller(); const jump0 = await page.getByText("Jump to latest").first().isVisible().catch(() => false);
      const n0 = agentMsgs(await threadsMsgs()).length;
      await send("Say the word PINEAPPLE.");
      await waitFirstText(n0 + 1); await page.waitForTimeout(1500);
      const seen = (await body()).includes("PINEAPPLE") && (await body()).includes("Say the word PINEAPPLE.");
      const sc1 = await scroller(); const s = await shot("b08b-send-while-scrolled-up");
      assert.ok(seen, `the sent message and its reply are on screen (scrolled up ${sc0?.top} -> ${sc1?.top}/${sc1?.max}; jump button before: ${jump0})`);
      return { result: "in view", shot: s };
    });

    // markdown, code and a table
    await step("B", "markdown, a code block and a table render right", async () => {
      const n0 = agentMsgs(await threadsMsgs()).length;
      await send("Reply with exactly: a level-2 heading, a bullet list of two items, a python code block that prints hi, and a markdown table with 2 columns and 2 rows. Nothing else.");
      await waitFirstText(n0 + 1); await waitIdle(); await page.waitForTimeout(800);
      const seen = await page.evaluate(() => ({ table: document.querySelectorAll("table").length, pre: document.querySelectorAll("pre").length, li: document.querySelectorAll("li").length, h: document.querySelectorAll("h1,h2,h3,[role=heading]").length, raw: /\|\s*-{3}|```|^##\s/m.test(document.body.innerText) }));
      const s = await shot("b09-markdown");
      assert.ok(seen.table >= 1 || !seen.raw, `table rendered: ${JSON.stringify(seen)}`);
      assert.ok(!seen.raw, `no raw markdown marks on screen: ${JSON.stringify(seen)}`);
      return { result: JSON.stringify(seen), shot: s };
    });

    // reload mid-stream
    await step("B", "reload mid-stream", async () => {
      const n0 = agentMsgs(await threadsMsgs()).length;
      await send("Write 300 numbered lines, each a short fact about forests. Nothing else.");
      await waitFirstText(n0 + 1); await page.waitForTimeout(1200);
      const tR = Date.now();
      await page.reload({ waitUntil: "load" });
      await page.getByTestId("shell").waitFor({ timeout: 30_000 });
      const reloadMs = Date.now() - tR;
      const sDuring = await shot("b10-reload-mid");
      const idle = await waitIdle(120_000); await page.waitForTimeout(1000);
      const ms2 = agentMsgs(await threadsMsgs()); const last = ms2.at(-1)!.body;
      const head = last.trim().split("\n").filter((l) => l.trim() !== "").at(-1)!.trim().slice(0, 40);
      const count = (await body()).split(head).length - 1;
      const s = await shot("b11-reload-done");
      assert.equal(count, 1, `the reply shows once after the reload (${count}): ${head}`);
      assert.equal(ms2.length, n0 + 1, "one reply message, not two");
      return { result: "one coherent reply", ms: reloadMs, shot: `${sDuring}, ${s}`, note: `reload to shell ${reloadMs} ms; finished ${idle} ms later` };
    });
    await guard.check("after the reload mid-stream");

    // daemon restart mid-stream
    await step("B", "daemon restart mid-stream", async () => {
      const n0 = agentMsgs(await threadsMsgs()).length;
      await send("Write 300 numbered lines, each a short fact about deserts. Nothing else.");
      await waitFirstText(n0 + 1); await page.waitForTimeout(1500);
      const tK = Date.now();
      await d.stop("SIGTERM");
      await page.waitForTimeout(2000);
      const sDown = await shot("b12-daemon-down-midstream");
      const bDown = await body();
      await d.start();
      const tUp = Date.now() - tK;
      let back = -1;
      for (let i = 0; i < 400; i++) { const b = await body(); if (!/Sign in to/.test(b) && (await field.isVisible().catch(() => false)) && !(await stopVisible())) { back = Date.now() - tK; break; } await page.waitForTimeout(250); }
      await page.waitForTimeout(2500);
      const sBack = await shot("b13-after-daemon-midstream");
      const ms2 = await threadsMsgs(); const a = agentMsgs(ms2);
      const last = a.at(-1)!; const words = (await body()).match(/(Stopped|stopped|Interrupted|interrupted|Retry|Try again|went wrong)[^|]*/g) ?? [];
      const doubled = a.length > n0 + 1;
      // the next message works
      const r = await turn("Say OK.", { tag: "b14", limitMs: 90_000 });
      assert.ok(back >= 0, "the chat came back");
      assert.ok(r.done >= 0, "the next message works after the restart");
      assert.ok(!doubled, `no second reply was made (${a.length} agent messages vs ${n0 + 1})`);
      return { result: `recovered; reply ${last.body.length} chars; words: ${words.join(" / ") || "none"}`, ms: back, shot: `${sDown}, ${sBack}`, note: `down screen text: ${bDown.slice(0, 200)}; daemon listening after ${tUp} ms; recovery (press to usable) ${back} ms` };
    });
    await guard.check("after the daemon restart mid-stream");

    // a message sent while the daemon is down
    await step("B", "send a message while the daemon is down", async () => {
      await waitIdle(120_000);
      await d.stop("SIGTERM"); await page.waitForTimeout(1500);
      const tSend = Date.now();
      await field.fill("Say the word DOWNSEND."); await field.press("Enter");
      await page.waitForTimeout(3000);
      const bDown = await body(); const sDown = await shot("b15-send-while-down");
      const tStart = Date.now(); await d.start();
      let answered = -1;
      for (let i = 0; i < 360; i++) { const a = agentMsgs(await threadsMsgs().catch(() => [])); if (a.at(-1)?.body.includes("DOWNSEND")) { answered = Date.now() - tStart; break; } await page.waitForTimeout(500); }
      const sUp = await shot("b16-send-while-down-after");
      const b2 = await body();
      await page.getByRole("button", { name: "Discard" }).first().click({ timeout: 3000 }).catch(() => undefined);
      return { result: answered >= 0 ? "delivered and answered after the daemon came back" : "NOT answered", ms: answered, shot: `${sDown}, ${sUp}`, note: `3 s after pressing Enter with the daemon down: ${bDown.slice(-230)}; after it came back: ${b2.slice(-160)}; draft left in the composer: ${JSON.stringify(((await field.innerText().catch(() => "")) || "").slice(0, 40))}; pressed at +${Date.now() - tSend} ms` };
    });

    // an unreachable AI host, then a bad key, each for one message
    const errorWords = async (): Promise<string> => { const b = await body(); const i = b.lastIndexOf("Say the word"); return b.slice(Math.max(0, i), i + 420); };
    await step("B", "the AI host is unreachable for one message", async () => {
      await waitIdle(120_000);
      await d.stop("SIGTERM"); d.env["NODE_OPTIONS"] = `${d.env["NODE_OPTIONS"] ?? ""} ${unreachablePreload(d.dir)}`.trim(); await d.start();
      await page.waitForTimeout(3000);
      const t0 = Date.now();
      await field.fill("Say the word UNREACH."); await field.press("Enter");
      let said = -1;
      for (let i = 0; i < 240; i++) { const b = await body(); if (/refused|unreachable|could not reach|can't reach|cannot reach|did not answer|try again|Retry|busy or down/i.test(b.slice(b.lastIndexOf("Say the word UNREACH") + 21))) { said = Date.now() - t0; break; } await page.waitForTimeout(500); }
      const s = await shot("b17-unreachable");
      const words = await errorWords();
      const retry = await page.getByRole("button", { name: "Retry" }).count();
      await d.stop("SIGTERM"); delete d.env["NODE_OPTIONS"]; await d.start();
      assert.ok(said >= 0, "the chat said what happened");
      return { result: `said after ${said} ms; Retry buttons ${retry}`, ms: said, shot: s, note: words };
    });
    await step("B", "a wrong key for one message", async () => {
      await page.waitForTimeout(3000);
      // a made-up short value, not shaped like any key; the daemon accepts it for this walk only (VYRE_TEST_KEY_CHECK=accept), as the app's own check would refuse it at Add
      const refused = await context.request.post(`${web.origin}/v1/providers/add`, { headers: { authorization: `Bearer ${token}` }, data: { idempotencyKey: `g-badkey-real-${Date.now()}`, providerKey: "opencode-go", connection: "api_key", apiKey: "gate-bad-key-0001", scope: "mine" } });
      const refusedBody = (await refused.text()).replaceAll(REAL_KEY, "***").slice(0, 300);
      await waitIdle(60_000).catch(() => undefined);
      await d.stop("SIGTERM"); d.env["VYRE_TEST_KEY_CHECK"] = "accept"; await d.start(); await page.waitForTimeout(3000);
      await api("providers.remove", { providerId: prov.provider.id });
      const bad = await api("providers.add", { providerKey: "opencode-go", connection: "api_key", apiKey: "gate-bad-key-0001", scope: "mine" });
      const t0 = Date.now();
      await field.fill("Say the word BADKEY."); await field.press("Enter");
      let said = -1;
      for (let i = 0; i < 240; i++) { const b = await body(); if (/refused|did not accept|not accepted|sign in again|api key|Retry|Add a key|busy or down/i.test(b.slice(b.lastIndexOf("Say the word BADKEY") + 21))) { said = Date.now() - t0; break; } await page.waitForTimeout(500); }
      const s = await shot("b18-bad-key");
      const b = await body(); const words = b.slice(Math.max(0, b.lastIndexOf("Say the word BADKEY")), b.lastIndexOf("Say the word BADKEY") + 420);
      // put the good key back
      await api("providers.remove", { providerId: bad.provider.id });
      await d.stop("SIGTERM"); delete d.env["VYRE_TEST_KEY_CHECK"]; d.env["VYRE_TEST_KEY_CHECK"] = "real"; await d.start(); await page.waitForTimeout(3000);
      assert.ok(said >= 0, "the chat said what happened");
      return { result: `said after ${said} ms; the real check at Add says: ${refusedBody.slice(0, 160)}`, ms: said, shot: s, note: words };
    });
    fs.writeFileSync(path.join(shots, "failures.txt"), failures.join("\n"));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); web.close(); await d.stop(); fs.writeFileSync(path.join(shots, "daemon.log"), d.log().replaceAll(REAL_KEY, "***")); }
  assert.deepEqual(failures, [], "every step of the walk passed");
});
