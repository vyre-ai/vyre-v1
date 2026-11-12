// @tsx
// Release gate (12 Nov 2026): ordinary web research with no helpers. "Look up the population of Reykjavik on the web and tell me the source." Does the first link read go through or stop with a card; a second
// lookup in the same turn; a lookup in the next turn; what each card says (exact title and body, copied to the log). Personal Space in the app, then a Team channel where a member (not the owner) asks.
// Nothing is pressed: a card is only recorded. Skips without OPENCODE_API_KEY. Lines start with GATE LOOKUP.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { GATE_MODEL, REAL_KEY, bootGate, claimInBrowser, gateSkip, tokenOf } from "./gate-kit.test.ts";

type Page = import("playwright-core").Page;
const body = async (p: Page): Promise<string> => ((await p.evaluate("document.body.innerText").catch(() => "")) as string).replace(/\n+/g, " | ");

for (const kind of ["personal", "team"] as const) {
  test(`GATE lookup, ${kind} Space: a plain web lookup, no helpers`, { skip: gateSkip() || (process.env["GATE_KIND"] && process.env["GATE_KIND"] !== kind ? "another kind is selected" : false), timeout: 900_000 }, async () => {
    const { chromium } = await import("playwright-core");
    const shots = path.join(process.env["VYRE_GATE_SHOTS"] ?? "/tmp/vyre-gate-shots", `lookup-${kind}`); fs.mkdirSync(shots, { recursive: true });
    const d = await bootGate(kind, "Lookup Space");
    const web = await edge(process.env["VYRE_APP_DIST"]!, d.address);
    const browser = await chromium.launch({ executablePath: process.env["CHROME_BIN"] || chromium.executablePath(), args: ["--no-sandbox"] });
    let agentId = "";
    try {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }); const page = await ctx.newPage();
      await claimInBrowser(page, d.claim!.replace(d.address, web.origin), { name: "Look Owner", username: "look", password: "look walk password 1" }); await dismissOnboarding(page);
      const token = await tokenOf(page);
      const call = async (cap: string, data: unknown = {}, tok = token): Promise<any> => { const r = await ctx.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${tok}` }, data: { idempotencyKey: `l-${Math.random()}`, ...(data as object) } }); const j = (await r.json().catch(() => ({}))) as any; if (r.status() !== 200) throw new Error(`${cap}: ${r.status()} ${JSON.stringify(j).replaceAll(REAL_KEY, "***").slice(0, 200)}`); return j.data; };   // eslint-disable-line @typescript-eslint/no-explicit-any
      if (kind === "team") { await call("providers.space_key.set", { providerKey: "opencode-go", apiKey: REAL_KEY }); await call("engine.models.list", { refresh: true, wait: true }); }
      else await call("providers.add", { providerKey: "opencode-go", connection: "api_key", apiKey: REAL_KEY, scope: "mine" });
      let asker = token; let askerPage = page; let thread = ""; let mention = "";
      if (kind === "personal") {
        const agent = (await call("agents.list")).agents[0] as { agentId: string }; agentId = agent.agentId; mention = agentId;
        await call("agents.update", { agentId, patch: { model: GATE_MODEL } });
        thread = (await call("chat.start", { kind: "chat", agentIds: [agentId], title: "lookup" })).thread.threadId;
      } else {
        const dex = (await call("agents.create", { name: "Dex", role: "Answers questions, looks things up on the web.", computer: false })).agent as { agentId: string }; agentId = dex.agentId; mention = dex.agentId;
        await call("agents.update", { agentId, patch: { model: GATE_MODEL } });
        const home = (await call("channels.home")).channel as { channelId: string; mainThreadId: string };
        await call("channels.agents.add", { channelId: home.channelId, agentId: dex.agentId, mode: "listen" }); thread = home.mainThreadId;
        const roles = (await call("access.roles.list")).roles as Array<{ id: string; name: string }>;
        const made = await call("members.invites.create", { role: roles.find((r) => r.name === "Member")!.id }); const link = new URL(made.link);
        const mctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }); const mp = await mctx.newPage();
        await mp.goto(web.origin + link.pathname + link.hash, { waitUntil: "load" }); await mp.getByTestId("step-accept").waitFor({ timeout: 20_000 }); await mp.getByTestId("web").click();
        await mp.getByTestId("first").fill("Maya"); await mp.getByTestId("last").fill("Lin"); await mp.getByTestId("next").click();
        await mp.getByTestId("username").fill("maya"); await mp.getByTestId("password").fill("look walk password 1"); await mp.getByTestId("confirm").fill("look walk password 1"); await mp.getByTestId("next").click();
        await mp.getByTestId("device").fill("Gate browser"); await mp.getByTestId("next").click(); await mp.getByTestId("ai-none").click(); await mp.getByTestId("next").click();
        await mp.getByTestId("shell").waitFor({ timeout: 40_000 }); await dismissOnboarding(mp);
        asker = await tokenOf(mp); askerPage = mp;
        await mp.goto(`${web.origin}/chats`, { waitUntil: "load" }); await mp.getByTestId("shell").waitFor({ timeout: 30_000 }); await mp.getByText(/^#?vyre$/).first().click().catch(() => undefined);
      }
      const turnsOf = async (): Promise<Array<{ state: string; startedAt?: number }>> => ((await call("engine.turns.list", { threadId: thread })).turns ?? []);
      const ask = async (label: string, text: string, waitMs = 150_000): Promise<void> => {
        const t0 = Date.now(); await call("chat.post", { threadId: thread, body: text, mentions: [{ kind: "agent", id: mention }] }, asker);
        let cardSeen = -1; let end = ""; let state = "";
        while (Date.now() - t0 < waitMs) {
          const b = await body(askerPage);
          if (cardSeen < 0 && /Allow|Approval|Always allow|needs you|Needs you|hold/i.test(b.slice(b.lastIndexOf(text.slice(0, 20))))) { cardSeen = Date.now() - t0; await askerPage.screenshot({ path: path.join(shots, `${label}-card.png`) }); }
          const t = await turnsOf(); state = t.map((x) => x.state).slice(0, 3).join(",");
          if (t.length && !t.some((x) => x.state === "running" || x.state === "queued")) break;
          await askerPage.waitForTimeout(700);
        }
        end = await body(askerPage); await askerPage.screenshot({ path: path.join(shots, `${label}-end.png`) });
        const tail = end.slice(Math.max(0, end.lastIndexOf(text.slice(0, 20))), end.lastIndexOf(text.slice(0, 20)) + 900);
        const cards = (await call("tasks.list", { scope: "all", kinds: ["approve"], states: ["todo", "doing"], limit: 50 }).catch((e: Error) => ({ tasks: [], err: e.message }))) as { tasks?: Array<{ title?: string; summary?: string; kind?: string }>; err?: string };
        const buttons = await askerPage.evaluate(() => [...document.querySelectorAll("[role=button],button")].map((b) => (b as HTMLElement).innerText.trim()).filter((x) => /allow|deny|always|approve|decline/i.test(x)).join(" / "));
        console.log(`GATE LOOKUP ${kind} ${label} CARDS: ${JSON.stringify((cards.tasks ?? []).map((x) => [x.title, x.summary]))} ${cards.err ?? ""}; buttons on screen: ${buttons}`);
        console.log(`GATE LOOKUP ${kind} ${label}: after ${Date.now() - t0} ms turn states [${state}]; card seen at ${cardSeen} ms; screen after the ask: ${tail}`);
      };
      await ask("1-first", "Look up the population of Reykjavik on the web and tell me the source.");
      const allow = askerPage.getByRole("button", { name: /^Allow$/ }).first();
      if (await allow.count()) { const tA = Date.now(); await allow.click({ force: true }); let st = ""; for (let i = 0; i < 200; i++) { const t = await turnsOf(); st = t.map((x) => x.state).slice(0, 3).join(","); if (t.length && !t.some((x) => x.state === "running" || x.state === "queued" || x.state === "waiting")) break; await askerPage.waitForTimeout(700); } await askerPage.screenshot({ path: path.join(shots, "1b-after-allow.png") }); const e = await body(askerPage); console.log(`GATE LOOKUP ${kind} after Allow: ${Date.now() - tA} ms, turn states [${st}]; screen: ${e.slice(Math.max(0, e.lastIndexOf("Look up the population")), e.lastIndexOf("Look up the population") + 700)}`); } else console.log(`GATE LOOKUP ${kind}: no Allow button on screen`);
      await ask("2-second", "Now look up the population of Akureyri on the web too and tell me the source.");
      await ask("3-both-in-one", "In one answer, look up the population of Kopavogur and of Hafnarfjordur on the web, with a source for each.");
      assert.ok(thread);
    } finally {
      await browser.close(); web.close(); await d.stop();
      if (agentId !== "") for (const id of execFileSync("docker", ["ps", "-aq", "--filter", `label=vyre.workspace=${agentId}`], { encoding: "utf8" }).split("\n").filter(Boolean)) execFileSync("docker", ["rm", "-f", id]);
    }
  });
}
