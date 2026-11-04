// The real-app walk for agents replying in threads (lane l-threadreplies), on box B with no reinstall: the lane's own exported apps/app/dist and the shared node_modules. A booted daemon with a scripted
// model; Mia asks the agent in a project channel; the walk checks over the API that the reply landed in the thread and not in the chat, then opens the real web app as Mia and shoots the chat with the live
// footer, the thread beside it, the finished footer, the switch turned off and a second ask answered inline, and the same on a phone.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const R = "/root/wt/l-threadreplies";
const eco = await import(R + "/test/support/eco-live.ts");
const h = await import(R + "/apps/app/tests/real-app-harness.test.ts");
const { guardCrashes } = await import(R + "/apps/app/tests/crash-guard.ts");
const { CORE_SPACE } = await import(R + "/fixtures/seed/core/index.ts");
const require = createRequire(R + "/package.json");
const { chromium } = require("playwright-core");
const out = process.argv[2] ?? "/root/wt/tmp-l-threadreplies/walk-shots";
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
setTimeout(() => { console.log("WATCHDOG"); process.exit(9); }, 1000000).unref();

const WHO = ["usr_olivia", "usr_mia"];
let agentId = "";
const model = eco.scriptedModel(async function* (input: any, run: any) {
  const said = input.trigger?.body ?? "";
  if (/vendor call/.test(said)) {
    yield { type: "text", text: "Two helpers. Tess checks the vendor calendar and Orin compares the quotes. " };
    await new Promise((r) => setTimeout(r, 30000));
    yield { type: "text", text: "Harbor costs $260 more up front, but its setup is two weeks sooner. Thursday 14:00 is free. Want me to book it?" };
  } else if (/loop in Noah/.test(said)) {
    // an outward act nobody asked for in words: the Gate holds it and the turn parks on an approval
    yield { type: "text", text: "I will tell Noah. " };
    yield* run("tool_search", { query: "people status message person" });
    const w = yield* run("people_status", { q: "Noah" });
    const handle = (((w.content as any).data?.people ?? [])[0] ?? {}).handle ?? "noah";
    yield* run("message_person", { to: handle, body: "The vendor call is Thursday at 14:00.", idempotencyKey: "walk-noah-1" });
    yield { type: "text", text: "Sent." };
  } else yield { type: "text", text: "Got it. Noted for the summary." };
});

console.log("step boot");
const ownerToken = { v: "" };
const d = await eco.boot(eco.seededDir(), model, {
  vault: undefined,
  session: (headers: Record<string, string | undefined>) => {
    const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
    const id = t === ownerToken.v ? "usr_olivia" : t;
    return WHO.includes(id) ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "threadreplies-walk" } : null;
  },
});
ownerToken.v = d.token;
const api = async (who: string, cap: string, input: unknown): Promise<any> => {
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify(input) });
  const b = (await r.json()) as any; if (r.status !== 200) console.log("API", who, cap, r.status, JSON.stringify(b).slice(0, 300)); return b.data ?? b;
};
const list = async (who: string, threadId: string): Promise<any[]> => { await d.hooks?.pump?.(); return (await api(who, "chat.messages.list", { threadId })).messages ?? []; };
const until = async (f: () => Promise<boolean>, what: string, ms = 60000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await new Promise((r) => setTimeout(r, 250)); } console.log("NEVER", what); return false; };

await eco.connect(d);
agentId = (await api("usr_olivia", "agents.create", { name: "Intake", role: "You help the team.", idempotencyKey: "w-agent" })).agent.agentId;
const keys = await api("usr_olivia", "vault.folders.create", { idempotencyKey: "w-ai", name: "AI accounts", scope: "shared" });
const acct = await api("usr_olivia", "providers.add", { idempotencyKey: "w-acct", providerKey: "anthropic", connection: "api_key", apiKey: `${eco.KEY}A`, name: "Team AI", scope: "shared", folderId: keys.folder.id });
await api("usr_olivia", "agents.update", { agentId, patch: { accountPolicy: "key", accountKey: acct.provider.handle }, idempotencyKey: "w-upd" });
const chan = (await api("usr_mia", "channels.create", { name: "Vendor onboarding", visibility: "public", memberIds: ["usr_olivia"], agentIds: [agentId], idempotencyKey: "w-chan" })).channel;
const main = chan.mainThreadId as string;

console.log("step drive");
const ask = (await api("usr_mia", "chat.post", { threadId: main, body: "Find a time for the vendor call next week, and compare the two quotes.", mentions: [{ kind: "agent", id: agentId }], idempotencyKey: "w-ask1" })).message;
const under = async (): Promise<any | null> => ((await api("usr_mia", "threads.list", { parentThreadId: main })).threads ?? []).find((t: any) => t.parentMessageId === ask.messageId) ?? null;
await until(async () => (await under()) !== null, "the thread under the ask");
const thr = await under();
console.log("THREAD", thr?.threadId, "replyCount", thr?.replyCount);

{ const { DatabaseSync } = await import("node:sqlite"); const db = new DatabaseSync(d.paths.modules);
  for (const id of ["usr_mia"]) { try { db.prepare(`INSERT OR IGNORE INTO identity_accounts (person_id, username, name, verifier, created_at) VALUES (?, ?, ?, 'test', ?)`).run(id, id.slice(4), "Mia Torres", Date.now()); } catch (e) { console.log("acct", String(e).slice(0, 120)); } }
  db.close(); }

console.log("step edge");
const web = await h.edge(R + "/apps/app/dist", d.url);
const origin = web.origin;
const browser = await chromium.launch({ args: ["--no-sandbox"] });
async function open(who: string, o: { mode?: "light" | "dark"; w?: number; hh?: number } = {}) {
  const ctx = await browser.newContext({ viewport: { width: o.w ?? 1440, height: o.hh ?? 900 }, colorScheme: o.mode ?? "light", deviceScaleFactor: 1 });
  const sp = await api(who, "spaces.get", {});
  const s = { ...h.ownerSession({ url: d.url, token: who, space: CORE_SPACE, dir: "", stop: async () => undefined, claim: null }, origin), token: who, personId: who, marker: sp?.space?.fingerprint, username: who.slice(4) };
  (s.def as any).name = "Northwind"; (s.def as any).role = "Member"; (s.def as any).console = false;
  await ctx.addInitScript((val: string) => { try { if (!localStorage.getItem("vyre.session.v1")) localStorage.setItem("vyre.session.v1", val); } catch {} }, JSON.stringify({ sessions: { [origin]: s } }));
  const page = await ctx.newPage();
  guards.set(page, guardCrashes(page));
  page.on("pageerror", (e: Error) => { console.log("PAGEERROR", e.message.slice(0, 300)); });
  await page.goto(origin + "/chat", { waitUntil: "load" });
  for (let i = 0; i < 3; i++) {
    await page.getByText("Continue", { exact: true }).click({ timeout: 1500 }).catch(() => undefined);
    await page.getByTestId("onboarding-close").click({ timeout: 2500 }).catch(() => undefined);
    await page.getByText("Finish later", { exact: true }).click({ timeout: 1500 }).catch(() => undefined);
  }
  await page.getByText("Hide", { exact: true }).first().click({ timeout: 1500 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  await page.getByText("Vendor onboarding", { exact: true }).first().click({ timeout: 15000 }).catch((e: any) => console.log("nochan", String(e).slice(0, 160)));
  await page.getByText("Find a time for the vendor call").first().waitFor({ timeout: 15000 }).catch(() => console.log("noask"));
  await page.waitForTimeout(1500);
  return { ctx, page };
}
/** The crash guard of each page (apps/app/tests/crash-guard.ts): checked before every shot, so a shot of an error page or of a page that logged a React or script error is a failed walk, not a picture. */
const guards = new Map<any, any>();
let crashed = 0;
const shot = async (page: any, name: string) => { await page.waitForTimeout(700); try { await guards.get(page)?.check(`before ${name}`); } catch (e) { crashed++; console.log("CRASH", String(e instanceof Error ? e.message : e).slice(0, 400)); } await page.screenshot({ path: path.join(out, name + ".png") }); console.log("shot", name); };
const checks: string[] = [];
let checksFailed = 0;
let failed = false;
/** One checked fact: its line is printed, and a fact that is not as expected fails the walk. */
const check = (line: string, ok: boolean): void => { checks.push(line); if (!ok) { checksFailed++; checks.push(`  ^ FAILED: ${line}`); } };
try {
  // the chat holds the ask only; the reply is in the thread
  const chatNow = await list("usr_mia", main);
  const agentInChat = chatNow.filter((m: any) => m.author?.id === agentId && !/needs your OK/.test(m.body ?? ""));
  check(`while writing: agent messages in the chat = ${agentInChat.length}`, agentInChat.length === 0);
  for (const mode of ["light", "dark"] as const) {
    { const { page, ctx } = await open("usr_mia", { mode });
      await page.getByText(/Working/).first().waitFor({ timeout: 20000 }).catch(() => console.log("nowriting"));
      await shot(page, `main-writing-${mode}`);
      await page.getByText(/reply|Working/).first().click({ timeout: 8000 }).catch((e: any) => console.log("nofoot", String(e).slice(0, 120)));
      await page.waitForTimeout(1200);
      await shot(page, `thread-open-${mode}`);
      await ctx.close(); }
  }
  await until(async () => /Want me to book it/.test((await list("usr_mia", thr.threadId)).map((m: any) => m.body).join(" ")), "the reply in the thread", 90000);
  const inThread = await list("usr_mia", thr.threadId);
  const inChat = await list("usr_mia", main);
  { const inMain = inChat.filter((m: any) => m.author?.id === agentId).length; check(`after: thread messages = ${inThread.length}, agent messages in the chat = ${inMain}`, inThread.length >= 1 && inMain === 0); }
  for (const mode of ["light", "dark"] as const) {
    { const { page, ctx } = await open("usr_mia", { mode });
      await shot(page, `main-done-${mode}`);
      await page.getByText(/replies|reply/).first().click({ timeout: 8000 }).catch(() => undefined);
      await page.waitForTimeout(1200);
      await shot(page, `thread-done-${mode}`);
      await ctx.close(); }
    { const { page, ctx } = await open("usr_mia", { mode, w: 390, hh: 844 });
      await shot(page, `phone-main-${mode}`);
      await page.getByText(/replies|reply/).first().click({ timeout: 8000 }).catch((e: any) => console.log("nofoot-phone", String(e).slice(0, 120)));
      await page.waitForTimeout(1200);
      await shot(page, `phone-thread-${mode}`);
      await ctx.close(); }
  }
  // Also sent to the chat: Mia ticks "Also post to the chat" on her reply in the thread; the chat gets a copy that names its thread, the thread's message carries the mark
  await api("usr_mia", "chat.post", { threadId: thr.threadId, body: "Decision: book Thursday 14:00 and go with Harbor.", alsoToChat: true, idempotencyKey: "w-also" });
  await until(async () => (await list("usr_mia", main)).some((m: any) => (m.blocks ?? []).some((b: any) => b.type === "from_thread")), "the copy in the chat");
  { const has = (await list("usr_mia", main)).some((m: any) => (m.blocks ?? []).some((b: any) => b.type === "from_thread")); check(`also sent: copy in the chat carries from_thread = ${has}`, has); }
  for (const mode of ["light", "dark"] as const) {
    { const { page, ctx } = await open("usr_mia", { mode });
      await page.getByText("Also sent to the chat from a thread").first().waitFor({ timeout: 15000 }).catch(() => console.log("nocopy"));
      await shot(page, `main-also-sent-${mode}`);
      await page.getByText(/replies|reply/).first().click({ timeout: 8000 }).catch(() => undefined);
      await page.getByText("Also sent to the chat", { exact: true }).first().waitFor({ timeout: 15000 }).catch(() => console.log("nomark"));
      await shot(page, `thread-also-sent-${mode}`);
      await ctx.close(); }
  }
  { const { page, ctx } = await open("usr_mia", { mode: "light", w: 390, hh: 844 });
    await page.getByText(/replies|reply/).first().click({ timeout: 8000 }).catch(() => undefined);
    await page.getByText("Also sent to the chat", { exact: true }).first().waitFor({ timeout: 15000 }).catch(() => console.log("nomark-phone"));
    await shot(page, "phone-thread-also-sent-light"); await ctx.close(); }
  // the switch off: the next ask is answered in the chat itself
  await api("usr_mia", "threads.set_agent_replies", { threadId: main, inThreads: false });
  const ask2 = (await api("usr_mia", "chat.post", { threadId: main, body: "Thanks. Note that for the summary.", mentions: [{ kind: "agent", id: agentId }], idempotencyKey: "w-ask2" })).message;
  await until(async () => (await list("usr_mia", main)).some((m: any) => m.author?.id === agentId && /Noted for the summary/.test(m.body ?? "")), "the inline reply");
  const t2 = ((await api("usr_mia", "threads.list", { parentThreadId: main })).threads ?? []).find((t: any) => t.parentMessageId === ask2.messageId);
  { const inline = (await list("usr_mia", main)).some((m: any) => /Noted for the summary/.test(m.body ?? "")); check(`switch off: second ask answered in the chat = ${inline}, thread made = ${t2 !== undefined}`, inline && t2 === undefined); }
  { const { page, ctx } = await open("usr_mia", { mode: "light" }); await shot(page, "main-switch-off-light"); await ctx.close(); }
  // an approval asked in a thread: one quiet line in the chat that opens the thread, the card in the thread
  await api("usr_mia", "threads.set_agent_replies", { threadId: main, inThreads: true });
  const ask3 = (await api("usr_mia", "chat.post", { threadId: main, body: "Please loop in Noah about the Thursday call.", mentions: [{ kind: "agent", id: agentId }], idempotencyKey: "w-ask3" })).message;
  const held = await until(async () => ((await api("usr_mia", "gate.holds.list", { states: ["held"] })).holds ?? []).length > 0, "a held approval", 90000);
  const quiet = await until(async () => (await list("usr_mia", main)).some((m: any) => (m.blocks ?? []).some((b: any) => b.type === "turn_status" && /needs your OK/.test(JSON.stringify(b.data)))), "the quiet line in the chat", 60000);
  { const made = ((await api("usr_mia", "threads.list", { parentThreadId: main })).threads ?? []).some((t: any) => t.parentMessageId === ask3.messageId); check(`approval: held = ${held}, quiet line in the chat = ${quiet}, thread made under the ask = ${made}`, held === true && quiet === true && made); }
  for (const mode of ["light", "dark"] as const) {
    { const { page, ctx } = await open("usr_mia", { mode });
      await page.getByText(/needs your OK/).first().waitFor({ timeout: 15000 }).catch(() => console.log("noquiet"));
      await shot(page, `main-approval-${mode}`);
      await page.getByText("Open the thread", { exact: true }).first().click({ timeout: 8000 }).catch(() => console.log("noopen"));
      await page.waitForTimeout(1500);
      await shot(page, `thread-approval-${mode}`);
      await page.mouse.click(700, 760);   // click on empty space: nothing keeps focus
      await shot(page, `main-approval-unfocused-${mode}`);
      await ctx.close(); }
  }
  for (const mode of ["light", "dark"] as const) {
  { const { page, ctx } = await open("usr_mia", { mode, w: 390, hh: 844 });
    await page.getByText(/needs your OK/).first().waitFor({ timeout: 15000 }).catch(() => console.log("noquiet-phone"));
    await shot(page, `phone-main-approval-${mode}`);
    await page.getByText("Open the thread", { exact: true }).first().click({ timeout: 8000 }).catch(() => console.log("noopen-phone"));
    await page.waitForTimeout(1500);
    await shot(page, `phone-thread-approval-${mode}`); await ctx.close(); }
  }
} catch (e) { failed = true; console.log("WALK FAILED", e); }
console.log("CHECKS\n" + checks.join("\n"));
if (checksFailed > 0) console.log(`CHECKS failed: ${checksFailed}`);
if (failed) console.log("WALK FAILED: a step threw");
console.log(crashed === 0 ? "GUARD clean: no error page and no React or script error in any shot" : `GUARD FAILED: ${crashed} crash(es)`);
await browser.close(); web.close(); await eco.stop(d); process.exit(crashed === 0 && !failed && checksFailed === 0 ? 0 : 1);
