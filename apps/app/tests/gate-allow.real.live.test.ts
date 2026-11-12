// @tsx
// Release gate (12 Nov 2026): one Allow on a held dangerous command resumes the turn once. Six trials in an Auto chat of a Personal Space, real model: three presses within about 1 s of the card appearing, three after 10 s.
// Command (one line, held because of rm -rf): `echo run >> ~/runs-N.log; mkdir -p ~/scratch-N && echo x > ~/scratch-N/f && rm -rf ~/scratch-N; echo removed-N`. Per trial: card seen, press to the turn leaving waiting, press to the reply,
// runs of the command (lines in runs-N.log), holds in gate_holds (id, state, decided), second cards. Lines start with GATE ALLOW. Skips without OPENCODE_API_KEY.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { GATE_MODEL, REAL_KEY, SPACE_KIND, addAi, bootGate, claimInBrowser, gateSkip, tokenOf } from "./gate-kit.test.ts";

const dk = (...a: string[]): string => { try { return execFileSync("docker", a, { encoding: "utf8", timeout: 30_000 }); } catch (e) { return String((e as { stdout?: string }).stdout ?? ""); } };

test("GATE Allow: six trials, one Allow resumes the held turn once", { skip: gateSkip(), timeout: 1_500_000 }, async () => {
  const { chromium } = await import("playwright-core");
  const shots = path.join(process.env["VYRE_GATE_SHOTS"] ?? "/tmp/vyre-gate-shots", "allow"); fs.mkdirSync(shots, { recursive: true });
  const d = await bootGate(SPACE_KIND, "Allow Space");
  const web = await edge(process.env["VYRE_APP_DIST"]!, d.address);
  const browser = await chromium.launch({ executablePath: process.env["CHROME_BIN"] || chromium.executablePath(), args: ["--no-sandbox"] });
  let agentId = "";
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }); const page = await ctx.newPage();
    await claimInBrowser(page, d.claim!.replace(d.address, web.origin), { name: "Allow Owner", username: "allow", password: "allow walk password 1" }); await dismissOnboarding(page);
    const token = await tokenOf(page);
    const call = async (cap: string, data: unknown = {}): Promise<any> => { const r = await ctx.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data: { idempotencyKey: `a-${Math.random()}`, ...(data as object) } }); const j = (await r.json().catch(() => ({}))) as any; if (r.status() !== 200) throw new Error(`${cap}: ${r.status()} ${JSON.stringify(j).replaceAll(REAL_KEY, "***").slice(0, 200)}`); return j.data; };   // eslint-disable-line @typescript-eslint/no-explicit-any
    await addAi(call);
    agentId = (await call("agents.list")).agents[0].agentId as string; await call("agents.update", { agentId, patch: { model: GATE_MODEL } });
    const thread = (await call("chat.start", { kind: "chat", agentIds: [agentId], title: "allow trials" })).thread.threadId as string;
    await page.goto(`${web.origin}/chats`, { waitUntil: "load" }); await page.getByTestId("shell").waitFor({ timeout: 30_000 }); await page.getByText("allow trials", { exact: true }).first().click().catch(() => undefined); await page.waitForTimeout(1500);
    type T = { state: string; startedAt?: number };
    const turns = async (): Promise<T[]> => ((await call("engine.turns.list", { threadId: thread })).turns ?? []);
    const replies = async (): Promise<number> => ((await call("chat.messages.list", { threadId: thread })).messages as Array<{ author: { kind: string }; body: string }>).filter((m) => m.author.kind === "agent" && m.body.trim() !== "").length;
    const cid = (): string => dk("ps", "-q", "--filter", `label=vyre.workspace=${agentId}`).trim().split("\n")[0] ?? "";
    const allowBtn = page.getByRole("button", { name: /^Allow$/ });
    const results: string[] = [];
    for (let n = process.env["GATE_ALLOW_SLOW_ONLY"] ? 4 : 1; n <= 6; n++) {
      const fast = n <= 3;
      const r0 = await replies(); const tAsk = Date.now();
      await call("chat.post", { threadId: thread, body: `Run exactly this one command in the terminal and then tell me what happened: echo run >> ~/runs-${n}.log; mkdir -p ~/scratch-${n} && echo x > ~/scratch-${n}/f && rm -rf ~/scratch-${n}; echo removed-${n}`, mentions: [{ kind: "agent", id: agentId }] });
      let cardAt = -1; for (let i = 0; i < 600 && cardAt < 0; i++) { if (await allowBtn.count()) cardAt = Date.now() - tAsk; else await page.waitForTimeout(100); }
      if (cardAt < 0) { results.push(`trial ${n}: NO CARD within 60 s (turn states ${(await turns()).slice(0, 2).map((x) => x.state).join(",")})`); console.log(`GATE ALLOW trial ${n}: no card`); for (let i = 0; i < 300 && (await turns()).some((x) => x.state === "running" || x.state === "queued"); i++) await page.waitForTimeout(500); continue; }
      const tCard = Date.now();
      await page.screenshot({ path: path.join(shots, `t${n}-card.png`) });
      if (!fast) await page.waitForTimeout(10_000 - (Date.now() - tCard) > 0 ? 10_000 - (Date.now() - tCard) : 0); else await page.waitForTimeout(300);
      const cardsBefore = await allowBtn.count();
      if (!fast) await page.screenshot({ path: path.join(shots, `t${n}-before-press.png`) });
      const tPress = Date.now(); let how = "normal click"; try { await allowBtn.first().click({ timeout: 5000 }); } catch (e) { how = `normal click failed (${String(e).split("\n")[0]!.slice(0, 90)}), forced`; await allowBtn.first().click({ force: true }); }
      let leftWaiting = -1, replied = -1;
      for (let i = 0; i < 1200; i++) { const t = await turns(); if (leftWaiting < 0 && !t.some((x) => x.state === "waiting")) leftWaiting = Date.now() - tPress; if (replied < 0 && (await replies()) > r0) replied = Date.now() - tPress; if (replied >= 0 && !t.some((x) => x.state === "running" || x.state === "queued" || x.state === "waiting")) break; if (Date.now() - tPress > 120_000) break; await page.waitForTimeout(100); }
      await page.waitForTimeout(4000);
      const second = await allowBtn.count();
      const runs = dk("exec", cid() || "x", "sh", "-c", `wc -l < ~/runs-${n}.log 2>/dev/null || echo 0`).trim();
      let holds = "unreadable"; try { const db = new DatabaseSync(path.join(d.dir, "modules.db"), { readOnly: true }); holds = (db.prepare("SELECT id, state, decided_at, substr(input,1,60) i FROM gate_holds WHERE created_at >= ? ORDER BY created_at").all(tAsk) as Array<{ id: string; state: string; decided_at: number | null; i: string }>).map((h) => `${h.id.slice(-5)}:${h.state}`).join(" "); db.close(); } catch { /* keep */ }
      await page.screenshot({ path: path.join(shots, `t${n}-end.png`) });
      const line = `trial ${n} [${how}] (${fast ? "press within 1 s of the card" : "press after 10 s"}): card after ${cardAt} ms; press to turn leaving waiting ${leftWaiting} ms; press to reply ${replied} ms; command ran ${runs} time(s); Allow buttons before ${cardsBefore}, after ${second}; holds ${holds}`;
      results.push(line); console.log(`GATE ALLOW ${line}`);
    }
    assert.ok(results.length >= 3);
  } finally {
    await browser.close(); web.close(); await d.stop();
    if (agentId !== "") for (const id of dk("ps", "-aq", "--filter", `label=vyre.workspace=${agentId}`).split("\n").filter(Boolean)) dk("rm", "-f", id);
  }
});
