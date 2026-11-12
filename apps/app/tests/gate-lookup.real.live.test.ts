// @tsx
// Release gate (12 Nov 2026): ordinary web research with no helpers, and one approval that still exists. Personal Space, real model.
// Part 1: three lookups in one Auto chat ("look up the population of Reykjavik ... and tell me the source", then two more). Per ask: the time from the ask to the agent's reply, whether a card showed (exact text copied), turn states.
// Part 2: the chat is switched to Ask first, the agent is asked to write a file, the card appears, Allow is pressed as a person would; times from the Allow press to the held turn leaving "waiting" and to the reply.
// Lines start with GATE LOOKUP. Skips without OPENCODE_API_KEY.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { GATE_MODEL, REAL_KEY, SPACE_KIND, addAi, bootGate, claimInBrowser, gateSkip, tokenOf } from "./gate-kit.test.ts";

const body = async (p: import("playwright-core").Page): Promise<string> => ((await p.evaluate("document.body.innerText").catch(() => "")) as string).replace(/\n+/g, " | ");

test("GATE lookup (Personal Space): three lookups, then an Ask first approval with timings", { skip: gateSkip(), timeout: 900_000 }, async () => {
  const { chromium } = await import("playwright-core");
  const shots = path.join(process.env["VYRE_GATE_SHOTS"] ?? "/tmp/vyre-gate-shots", "lookup"); fs.mkdirSync(shots, { recursive: true });
  const d = await bootGate(SPACE_KIND, "Lookup Space");
  const web = await edge(process.env["VYRE_APP_DIST"]!, d.address);
  const browser = await chromium.launch({ executablePath: process.env["CHROME_BIN"] || chromium.executablePath(), args: ["--no-sandbox"] });
  let agentId = "";
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }); const page = await ctx.newPage();
    await claimInBrowser(page, d.claim!.replace(d.address, web.origin), { name: "Look Owner", username: "look", password: "look walk password 1" }); await dismissOnboarding(page);
    const token = await tokenOf(page);
    const call = async (cap: string, data: unknown = {}): Promise<any> => { const r = await ctx.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data: { idempotencyKey: `l-${Math.random()}`, ...(data as object) } }); const j = (await r.json().catch(() => ({}))) as any; if (r.status() !== 200) throw new Error(`${cap}: ${r.status()} ${JSON.stringify(j).replaceAll(REAL_KEY, "***").slice(0, 200)}`); return j.data; };   // eslint-disable-line @typescript-eslint/no-explicit-any
    await addAi(call);
    agentId = (await call("agents.list")).agents[0].agentId as string; await call("agents.update", { agentId, patch: { model: GATE_MODEL } });
    const thread = (await call("chat.start", { kind: "chat", agentIds: [agentId], title: "lookup" })).thread.threadId as string;
    await page.goto(`${web.origin}/chats`, { waitUntil: "load" }); await page.getByTestId("shell").waitFor({ timeout: 30_000 }); await page.getByText("lookup", { exact: true }).first().click().catch(() => undefined); await page.waitForTimeout(1500);
    type T = { state: string; startedAt?: number };
    const turns = async (): Promise<T[]> => ((await call("engine.turns.list", { threadId: thread })).turns ?? []);
    const agentReplies = async (): Promise<number> => ((await call("chat.messages.list", { threadId: thread })).messages as Array<{ author: { kind: string }; body: string }>).filter((m) => m.author.kind === "agent" && m.body.trim() !== "").length;
    const cardText = async (): Promise<string> => { const b = await body(page); const m = b.match(/[^|]*wants to[^|]*\|[^|]*(Approve|Allow|Review)[^|]*\|[^|]*/g); return (m ?? []).join(" // "); };
    const post = (text: string): Promise<unknown> => call("chat.post", { threadId: thread, body: text, mentions: [{ kind: "agent", id: agentId }] });
    const dbInfo = (since: number): string => {
      try {
        const db = new DatabaseSync(path.join(d.dir, "modules.db"), { readOnly: true });
        const tools = db.prepare("SELECT b.kind k, b.data d, b.at a FROM engine_turn_blocks b WHERE b.at >= ? AND b.kind = 'tool_call' ORDER BY b.at, b.idx").all(since) as Array<{ d: string }>;
        const holds = db.prepare("SELECT id, cap_name, state, created_at c, decided_at dd, substr(input,1,90) i FROM gate_holds WHERE created_at >= ? ORDER BY created_at").all(since) as Array<{ id: string; cap_name: string; state: string; c: number; dd: number | null; i: string }>;
        db.close();
        return `tool calls: ${tools.map((t) => { try { return (JSON.parse(t.d) as { name: string }).name; } catch { return "?"; } }).join(", ") || "none recorded"}; holds: ${holds.map((h) => `${h.id.slice(-5)} ${h.cap_name} ${h.state} created +${h.c - since} ms decided ${h.dd === null ? "never" : `+${h.dd - since} ms`} ${h.i.replace(/\s+/g, " ")}`).join(" | ") || "none"}`;
      } catch (e) { return `db read failed: ${String(e).slice(0, 80)}`; }
    };
    const ask = async (label: string, text: string, limit = 240_000): Promise<void> => {
      const n0 = await agentReplies(); const t0 = Date.now(); await post(text);
      let cardAt = -1, answerAt = -1, states = "";
      while (Date.now() - t0 < limit) {
        const t = await turns(); states = [...new Set(t.slice(0, 3).map((x) => x.state))].join(",");
        if (cardAt < 0 && /wants to/.test(await body(page))) { cardAt = Date.now() - t0; await page.screenshot({ path: path.join(shots, `${label}-card.png`) }); }
        if (answerAt < 0 && (await agentReplies()) > n0) answerAt = Date.now() - t0;
        if (answerAt >= 0 && !t.some((x) => x.state === "running" || x.state === "queued")) break;
        if (cardAt >= 0 && answerAt < 0 && Date.now() - t0 > cardAt + 30_000) break;   // a card is holding the turn: stop waiting, the card is the result
        await page.waitForTimeout(500);
      }
      await page.screenshot({ path: path.join(shots, `${label}-end.png`) });
      console.log(`GATE LOOKUP ${label} DB: ${dbInfo(t0)}`);
      console.log(`GATE LOOKUP ${label}: reply after ${answerAt} ms; card first seen after ${cardAt} ms; turn states [${states}]; cards on screen: ${await cardText() || "none"}`);
    };
    await ask("0-tools", "List the names of every tool you can call, names only, one line. Do not call any tool.");
    await ask("1-reykjavik", "Look up the population of Reykjavik on the web and tell me the source.");
    await ask("2-akureyri", "Now look up the population of Akureyri on the web too and tell me the source.");
    await ask("3-two-towns", "In one answer, look up the population of Kopavogur and of Hafnarfjordur on the web, with a source for each.");
    // part 2: a hold that exists in Auto: a command the terminal flags as dangerous
        const n0 = await agentReplies(); const tAsk = Date.now();
    await post("Run `rm -f ~/note-from-gate.txt` in the terminal and tell me what happened.");
    let cardAt = -1; for (let i = 0; i < 240 && cardAt < 0; i++) { if (/wants to|Allow/.test(await body(page)) && await page.getByRole("button", { name: /^Allow$/ }).count()) cardAt = Date.now() - tAsk; else await page.waitForTimeout(500); }
    await page.screenshot({ path: path.join(shots, "4-ask-first-card.png") });
    console.log(`GATE LOOKUP ask-first: card after ${cardAt} ms; text: ${await cardText() || (await body(page)).slice(-300)}; buttons: ${await page.evaluate(() => [...document.querySelectorAll("[role=button],button")].map((b) => (b as HTMLElement).innerText.trim()).filter((x) => /allow|deny|always|approve|decline/i.test(x)).join(" / "))}`);
    for (let card = 1; card <= 3; card++) {
      const allow = page.getByRole("button", { name: /^Allow$/ }).first(); if (!(await allow.count())) break;
      const tPress = Date.now(); await allow.click({ force: true });
      let leftWaiting = -1, replied = -1;
      while (Date.now() - tPress < 180_000) { const t = await turns(); if (leftWaiting < 0 && !t.slice(0, 1).some((x) => x.state === "waiting")) leftWaiting = Date.now() - tPress; if (replied < 0 && (await agentReplies()) > n0) replied = Date.now() - tPress; if (replied >= 0) break; if (leftWaiting >= 0 && await page.getByRole("button", { name: /^Allow$/ }).count() > 0) break; await page.waitForTimeout(300); }
      console.log(`GATE LOOKUP ask-first Allow #${card}: held turn left waiting after ${leftWaiting} ms; agent reply after ${replied} ms; another Allow still on screen: ${await page.getByRole("button", { name: /^Allow$/ }).count()}`);
      if (replied >= 0) break;
    }
    await page.screenshot({ path: path.join(shots, "5-ask-first-end.png") });
    assert.ok(thread);
  } finally {
    await browser.close(); web.close(); await d.stop();
    if (agentId !== "") for (const id of execFileSync("docker", ["ps", "-aq", "--filter", `label=vyre.workspace=${agentId}`], { encoding: "utf8" }).split("\n").filter(Boolean)) execFileSync("docker", ["rm", "-f", id]);
  }
});
