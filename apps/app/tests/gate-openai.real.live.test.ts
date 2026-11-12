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
    if (process.env["GATE_OPENAI_POLICY"] === "1") { const pol = await raw("engine.policy.set", { allowedModels: ["gpt-5.5", "gpt-5.4"] }); console.log(`GATE OPENAI policy allowed models [gpt-5.5, gpt-5.4]: ${pol.status}`); }
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
    // 2: pick gpt-5.6-luna by hand (set_model, what the menu calls), one tool message; watch for an error flash on screen
    if (process.env["GATE_OPENAI_LUNA"] !== "0") {
      const picked = await raw("engine.set_model", { threadId: thread, agentId, model: "gpt-5.6-luna" });
      console.log(`GATE OPENAI picked gpt-5.6-luna by hand: ${picked.status} ${clean(JSON.stringify(picked.data)).slice(0, 140)}`);
      let flash = false; const watch = (async () => { for (let i = 0; i < 80; i++) { if (page.isClosed()) return; if (/provider answered|bad_request|did not accept|refused this request|went wrong|Retry/i.test(await body())) { flash = true; await page.screenshot({ path: path.join(shots, "5-luna-flash.png") }); } await page.waitForTimeout(250); } })();
      await send("5-luna-terminal-job", "Run `echo luna-job-ok` in the terminal and tell me what it printed.");
      console.log(`GATE OPENAI luna: an error line showed on screen at some point: ${flash}`);
      void watch;
    }
  } finally {
    await browser.close(); web.close(); await d.stop();
    if (agentId !== "") for (const id of dk("ps", "-aq", "--filter", `label=vyre.workspace=${agentId}`).split("\n").filter(Boolean)) dk("rm", "-f", id);
  }
});
