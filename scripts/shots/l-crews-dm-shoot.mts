// Screenshots for l-crews: a Space agent (Dex) messaging Noah as itself next to an Assistant writing for Mia, on box B (no reinstall: the lane's own exported dist, the shared node_modules). A booted daemon with a scripted model, two members (Mia and Noah, plus Adam),
// driven through the same steps as test/agent-dm.team.live.test.ts, then the real web app opened as Noah and as Mia.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const R = "/root/wt/l-crews";
const eco = await import(R + "/test/support/eco-live.ts");
const h = await import(R + "/apps/app/tests/real-app-harness.test.ts");
const { CORE_SPACE } = await import(R + "/fixtures/seed/core/index.ts");
const require = createRequire(R + "/package.json");
const { chromium } = require("playwright-core");
const out = process.argv[2] ?? "/root/wt/tmp-l-crews/dm-shots";
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
setTimeout(() => { console.log("WATCHDOG"); process.exit(9); }, 300000).unref();

const WHO = ["usr_olivia", "usr_adam", "usr_mia", "usr_noah"];
let n = 0;
let dexId = "";
const model = eco.scriptedModel(async function* (input: any, run: any) {
  const said = input.trigger?.body ?? "";
  if (input.trigger?.author?.id === "usr_noah" && input.agent.id === dexId) { yield { type: "text", text: "Thanks Noah, noted. I will tell Mia." }; return; }
  const m = /^tell Noah (.+)$/.exec(said);
  if (m) {
    yield* run("tool_search", { query: "people status message person" });
    const w = yield* run("people_status", { q: "Noah" });
    const handle = (((w.content as any).data?.people ?? [])[0] ?? {}).handle ?? "noah";
    const r = yield* run("message_person", { to: handle, body: m[1][0].toUpperCase() + m[1].slice(1) + ".", idempotencyKey: `shoot-${++n}` });
    yield { type: "text", text: r.ok ? "Sent to Noah." : "That did not go." };
  } else if (/^Noah replied: /.test(said)) {
    yield { type: "text", text: "Noah says he will read it tonight." };
  }
});

console.log("step boot");
const d = await eco.boot(eco.seededDir(), model, {
  vault: undefined,
  session: (headers: Record<string, string | undefined>) => {
    const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
    const id = t === ownerToken.v ? "usr_olivia" : t;
    return WHO.includes(id) ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "agentdm-shoot" } : null;
  },
});
const ownerToken = { v: d.token };
const api = async (who: string, cap: string, input: unknown): Promise<any> => {
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify(input) });
  const b = (await r.json()) as any; if (r.status !== 200) console.log("API", who, cap, r.status, JSON.stringify(b).slice(0, 300)); return b.data ?? b;
};
const list = async (who: string, threadId: string): Promise<any[]> => { await d.hooks?.pump?.(); return (await api(who, "chat.messages.list", { threadId })).messages ?? []; };
const until = async (f: () => Promise<boolean>, what: string) => { const end = Date.now() + 30000; while (Date.now() < end) { if (await f()) return; await new Promise((r) => setTimeout(r, 200)); } console.log("NEVER", what); };

await eco.connect(d);
const opsId = (await api("usr_olivia", "agents.create", { name: "Ops", role: "You help Mia.", ownerId: "usr_mia", idempotencyKey: "s-ops" })).agent.agentId;
dexId = (await api("usr_olivia", "agents.create", { name: "Dex", role: "You help the team.", idempotencyKey: "s-dex" })).agent.agentId;
const keys = await api("usr_olivia", "vault.folders.create", { idempotencyKey: "s-ai", name: "AI accounts", scope: "shared" });
const acct = await api("usr_olivia", "providers.add", { idempotencyKey: "s-acct", providerKey: "anthropic", connection: "api_key", apiKey: `${eco.KEY}A`, name: "Team AI", scope: "shared", folderId: keys.folder.id });
for (const id of [opsId, dexId]) await api("usr_olivia", "agents.update", { agentId: id, patch: { accountPolicy: "key", accountKey: acct.provider.handle }, idempotencyKey: `s-upd-${id}` });
{ const { DatabaseSync } = await import("node:sqlite"); const db = new DatabaseSync(d.paths.modules); db.prepare("UPDATE agents_agent SET kind = 'assistant' WHERE id = ?").run(opsId); db.close(); }
const chatOps = (await api("usr_mia", "chat.start", { kind: "chat", agentIds: [opsId], title: "Rivera follow-ups", idempotencyKey: "s-chat1" })).thread.threadId;
const chatDex = (await api("usr_mia", "chat.start", { kind: "chat", agentIds: [dexId], title: "Brief Noah", idempotencyKey: "s-chat2" })).thread.threadId;
let k = 0;
const say = async (chat: string, agent: string, body: string, wait: RegExp) => { await api("usr_mia", "chat.post", { threadId: chat, body, mentions: [{ kind: "agent", id: agent }], idempotencyKey: `s-p${++k}` }); await until(async () => (await list("usr_mia", chat)).some((m) => wait.test(m.body ?? "")), String(wait)); };

console.log("step drive");
await say(chatOps, opsId, "tell Noah the Rivera draft is ready for his review", /^Sent to Noah\./);
const dm = (await api("usr_mia", "chat.start", { kind: "chat", agentIds: [], personId: "usr_noah", idempotencyKey: "s-dm" })).thread.threadId;
await api("usr_noah", "chat.post", { threadId: dm, body: "Thanks, I will read it tonight.", idempotencyKey: "s-n1" });
await say(chatDex, dexId, "tell Noah the Brightwater brief is in the shared folder", /^Sent to Noah\./);
// Noah finds Dex's own chat and answers there
const noahChats = JSON.stringify(await api("usr_noah", "chat.recent", {}));
let dexDm = "";
for (const id of [...new Set(noahChats.match(/thr_[0-9a-f]+/g) ?? [])]) { if ((await list("usr_noah", id)).some((m) => /Brightwater brief/.test(m.body ?? ""))) dexDm = id as string; }
await api("usr_noah", "chat.post", { threadId: dexDm, body: "Got it, thanks. Will review after lunch.", idempotencyKey: "s-n2" });
await until(async () => (await list("usr_mia", chatDex)).some((m) => /^Noah replied: /.test(m.body ?? "")), "report line");
await d.hooks?.pump?.();
{
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(d.paths.modules);
  const names: Record<string, string> = {};
  for (const p of (await api("usr_olivia", "access.principals.list", { kind: "person", limit: 50 })).principals ?? []) names[p.id] = p.name;
  for (const id of ["usr_mia", "usr_noah"]) { try { db.prepare(`INSERT OR IGNORE INTO identity_accounts (person_id, username, name, verifier, created_at) VALUES (?, ?, ?, 'test', ?)`).run(id, id.slice(4), names[id] ?? id, Date.now()); } catch (e) { console.log("acct", String(e).slice(0, 100)); } }
  db.close();
}
console.log("step edge");
const web = await h.edge(R + "/apps/app/dist", d.url);
const origin = web.origin;
const browser = await chromium.launch({ args: ["--no-sandbox"] });
async function open(who: string, o: { mode?: "light" | "dark"; w?: number; hh?: number } = {}) {
  const ctx = await browser.newContext({ viewport: { width: o.w ?? 1440, height: o.hh ?? 900 }, colorScheme: o.mode ?? "light", deviceScaleFactor: 1 });
  const sp = await api(who, "spaces.get", {});
  const s = { ...h.ownerSession({ url: d.url, token: who, space: CORE_SPACE, dir: "", stop: async () => undefined, claim: null }, origin), token: who, personId: who, marker: sp?.space?.fingerprint, username: who.slice(4) };
  (s.def as any).name = "Northwind"; (s.def as any).role = who === "usr_olivia" ? "Owner" : "Member"; (s.def as any).console = false;
  await ctx.addInitScript((val: string) => { try { if (!localStorage.getItem("vyre.session.v1")) localStorage.setItem("vyre.session.v1", val); } catch {} }, JSON.stringify({ sessions: { [origin]: s } }));
  const page = await ctx.newPage();
  page.on("pageerror", (e: Error) => { console.log("PAGEERROR", e.message.slice(0, 300)); });
  await page.goto(origin + "/chat", { waitUntil: "load" });
  await page.getByText("Continue", { exact: true }).click({ timeout: 2500 }).catch(() => undefined);
  await page.getByTestId("onboarding-close").click({ timeout: 6000 }).catch(() => undefined);
  await page.getByText("Finish later", { exact: true }).click({ timeout: 3000 }).catch(() => undefined);
  await page.getByText("Hide", { exact: true }).first().click({ timeout: 1500 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  return { ctx, page };
}
const shot = async (page: any, name: string) => { await page.waitForTimeout(700); await page.screenshot({ path: path.join(out, name + ".png") }); console.log("shot", name); };
try {
  // first open per person: the setup sheet; close it once so every shot after it is the chat
  for (const who of ["usr_noah", "usr_mia"]) {
    const { page, ctx } = await open(who, { mode: "light" });
    for (let i = 0; i < 3; i++) { await page.getByText("Finish later", { exact: true }).click({ timeout: 5000 }).catch(() => undefined); await page.getByTestId("onboarding-close").click({ timeout: 2000 }).catch(() => undefined); await page.waitForTimeout(800); }
    await ctx.close();
  }
  for (const mode of ["light", "dark"] as const) {
    // Noah: Mia's direct chat (the Assistant writing for her, signed "Mia (Agent)") and Dex's own chat with him
    { const { page, ctx } = await open("usr_noah", { mode });
      await page.getByText(/^Mia/).first().click({ timeout: 15000 }).catch((e: any) => console.log("nodm", String(e).slice(0, 160)));
      await page.getByText("The Rivera draft is ready for his review.").first().waitFor({ timeout: 15000 }).catch((e: any) => console.log("nodmmsg", String(e).slice(0, 160)));
      await shot(page, `noah-assistant-dm-${mode}`);
      await page.getByText(/^Dex/).first().click({ timeout: 15000 }).catch((e: any) => console.log("nodex", String(e).slice(0, 160)));
      await page.getByText("Brightwater brief").first().waitFor({ timeout: 15000 }).catch((e: any) => console.log("nodexmsg", String(e).slice(0, 160)));
      await shot(page, `noah-dex-chat-${mode}`);
      await ctx.close(); }
    // Mia: the chat she asked Dex in, with the one short line
    { const { page, ctx } = await open("usr_mia", { mode });
      await page.getByText("Brief Noah").first().click({ timeout: 15000 }).catch((e: any) => console.log("nochat", String(e).slice(0, 160)));
      await page.getByText(/Noah replied/).first().waitFor({ timeout: 15000 }).catch((e: any) => console.log("norelay", String(e).slice(0, 160)));
      await shot(page, `mia-dex-report-${mode}`);
      await ctx.close(); }
  }
  { const { page, ctx } = await open("usr_noah", { mode: "dark", w: 390, hh: 844 });
    await page.getByText(/^Dex/).first().click({ timeout: 15000 }).catch((e: any) => console.log("nodex-phone", String(e).slice(0, 160)));
    await shot(page, "noah-dex-chat-phone-dark"); await ctx.close(); }
} catch (e) { console.log("SHOOT FAILED", e); }
await browser.close(); web.close(); await eco.stop(d); process.exit(0);
