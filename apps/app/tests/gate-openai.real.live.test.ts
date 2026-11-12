// @tsx
// Release gate (12 Nov 2026): the first hour on a real OpenAI key. A new Personal Space, the person adds an OpenAI API key (OPENAI_API_KEY from the environment, never printed), picks no model, says hello, asks for one small terminal job.
// Records the model each turn ran on, the composer's model words, and the reply's details card; then restricts the Space to one other model and sends once more. A few short turns only (paid key). Lines start with GATE OPENAI.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { bootGate, claimInBrowser, recorder, tokenOf } from "./gate-kit.test.ts";

const KEY = process.env["OPENAI_API_KEY"] ?? "";
const dk = (...a: string[]): string => { try { return execFileSync("docker", a, { encoding: "utf8", timeout: 30_000 }); } catch (e) { return String((e as { stdout?: string }).stdout ?? ""); } };
void recorder;

test("GATE OpenAI first hour", { skip: KEY === "" ? "OPENAI_API_KEY is not set" : process.env["VYRE_APP_DIST"] ? false : "VYRE_APP_DIST is not set", timeout: 900_000 }, async () => {
  const { chromium } = await import("playwright-core");
  const shots = path.join(process.env["VYRE_GATE_SHOTS"] ?? "/tmp/vyre-gate-shots", "openai"); fs.mkdirSync(shots, { recursive: true });
  const d = await bootGate("personal", "Openai Space");
  const web = await edge(process.env["VYRE_APP_DIST"]!, d.address);
  const browser = await chromium.launch({ executablePath: process.env["CHROME_BIN"] || chromium.executablePath(), args: ["--no-sandbox"] });
  let agentId = "";
  const clean = (x: string): string => x.replaceAll(KEY, "***");
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }); const page = await ctx.newPage();
    await claimInBrowser(page, d.claim!.replace(d.address, web.origin), { name: "Oai Owner", username: "oai", password: "oai walk password 1" }); await dismissOnboarding(page);
    const token = await tokenOf(page);
    const raw = async (cap: string, data: unknown = {}): Promise<{ status: number; data: any }> => { const r = await ctx.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data: { idempotencyKey: `o-${Math.random()}`, ...(data as object) } }); const j = (await r.json().catch(() => ({}))) as any; return { status: r.status(), data: j.data ?? j }; };   // eslint-disable-line @typescript-eslint/no-explicit-any
    const call = async (cap: string, data: unknown = {}): Promise<any> => { const r = await raw(cap, data); if (r.status !== 200) throw new Error(clean(`${cap}: ${r.status} ${JSON.stringify(r.data).slice(0, 240)}`)); return r.data; };   // eslint-disable-line @typescript-eslint/no-explicit-any
    const added = await raw("providers.add", { providerKey: "openai", connection: "api_key", apiKey: KEY, scope: "mine" });
    console.log(`GATE OPENAI add key: ${added.status} ${clean(JSON.stringify(added.data)).slice(0, 200)}`);
    assert.equal(added.status, 200);
    const models = ((await call("engine.models.list", { refresh: true, wait: true })).models ?? []) as Array<{ model: string; allowed: boolean }>;
    console.log(`GATE OPENAI models listed (${models.length}): ${models.filter((m) => m.allowed).map((m) => m.model).slice(0, 40).join(", ")}`);
    agentId = (await call("agents.list")).agents[0].agentId as string;
    const thread = (await call("chat.start", { kind: "chat", agentIds: [agentId], title: "openai hour" })).thread.threadId as string;
    await page.goto(`${web.origin}/chats`, { waitUntil: "load" }); await page.getByTestId("shell").waitFor({ timeout: 30_000 }); await page.getByText("openai hour", { exact: true }).first().click().catch(() => undefined); await page.waitForTimeout(1500);
    const body = async (): Promise<string> => ((await page.evaluate("document.body.innerText").catch(() => "")) as string).replace(/\n+/g, " | ");
    type T = { state: string; model: string; startedAt?: number; error?: { code?: string; message?: string } };
    const send = async (label: string, text: string): Promise<void> => {
      const t0 = Date.now(); await call("chat.post", { threadId: thread, body: text, mentions: [{ kind: "agent", id: agentId }] });
      let row: T | undefined;
      for (let i = 0; i < 400; i++) { const t = ((await call("engine.turns.list", { threadId: thread })).turns ?? []) as T[]; row = t.filter((x) => (x.startedAt ?? 0) >= t0 - 1000)[0]; if (row && row.state !== "running" && row.state !== "queued") break; await new Promise((r) => setTimeout(r, 500)); }
      await page.waitForTimeout(1500); await page.screenshot({ path: path.join(shots, `${label}.png`) });
      const b = await body(); const tail = b.slice(Math.max(0, b.lastIndexOf(text.slice(0, 16))), b.lastIndexOf(text.slice(0, 16)) + 420);
      console.log(clean(`GATE OPENAI ${label}: ${row?.state ?? "no turn"} after ${Date.now() - t0} ms on model "${row?.model ?? ""}"${row?.error ? ` error ${row.error.code}: ${row.error.message}` : ""}; screen: ${tail}`));
    };
    await send("1-hello", "Hello! Reply with one short sentence.");
    const composer = await page.evaluate(() => [...document.querySelectorAll("[data-testid*=model],[data-testid*=composer-strip],[data-testid=composer]")].map((e) => (e as HTMLElement).innerText.replace(/\n+/g, " / ")).filter(Boolean).slice(0, 4).join(" || "));
    console.log(`GATE OPENAI composer words: ${composer.slice(0, 300)}; "Auto" visible: ${/\bAuto\b/.test(await body())}`);
    await send("2-terminal-job", "Run `echo openai-job-ok` in the terminal and tell me what it printed.");
    // the reply's details card
    const det = page.getByTestId("reply-details").last();
    if (await det.count()) { await det.click({ timeout: 5000 }).catch(() => undefined); await page.waitForTimeout(1000); await page.screenshot({ path: path.join(shots, "3-details-card.png") }); console.log(clean(`GATE OPENAI details card: ${(await body()).slice(-500)}`)); } else console.log("GATE OPENAI details card: no reply-details element on screen");
    // restrict the Space to one other model
    const used = ((await call("engine.turns.list", { threadId: thread })).turns as T[])[0]?.model ?? "";
    const other = models.filter((m) => m.allowed).map((m) => m.model).find((m) => m !== used && /gpt-[0-9.]+-mini$|mini/.test(m)) ?? models.filter((m) => m.allowed).map((m) => m.model).find((m) => m !== used) ?? "";
    const pol = await raw("engine.policy.set", { allowedModels: [other] });
    console.log(`GATE OPENAI policy: allowed models set to [${other}] (was running ${used}): ${pol.status} ${clean(JSON.stringify(pol.data)).slice(0, 160)}`);
    await send("4-after-policy", "Say OK.");
  } finally {
    await browser.close(); web.close(); await d.stop();
    if (agentId !== "") for (const id of dk("ps", "-aq", "--filter", `label=vyre.workspace=${agentId}`).split("\n").filter(Boolean)) dk("rm", "-f", id);
  }
});
