// @tsx
// Release gate, Team Space (12 Nov 2026): an owner and an invited member in two browsers against one real daemon and the real model. Claim, invite, join, a channel with two people and an agent,
// the same stream live in both views without a reload, two agents answering, then the member is removed while their app is open. Skips without OPENCODE_API_KEY.
// Rows and shots go to VYRE_GATE_SHOTS/team. Nothing here prints the key.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { guardCrashes } from "./crash-guard.ts";
import { GATE_MODEL, REAL_KEY, bootGate, claimInBrowser, gateSkip, recorder, tokenOf } from "./gate-kit.test.ts";

const PASSWORD = "gate walk password 4417";
type Msg = { author: { kind: string; id: string }; body: string; blocks?: Array<{ type: string; data?: Record<string, unknown> }> };

test("GATE (Team Space): owner and member, a channel with an agent, the same stream in both views, removal under an open app", { skip: gateSkip(), timeout: 1_500_000 }, async () => {
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  assert.ok(fs.existsSync(exe), `Chromium is required at ${exe}`);
  const shots = path.join(process.env["VYRE_GATE_SHOTS"] ?? "/tmp/vyre-gate-shots", "team"); fs.mkdirSync(shots, { recursive: true });
  const rec = recorder(shots, "rows.json");
  const d = await bootGate("team", "Gate Studio");
  const web = await edge(process.env["VYRE_APP_DIST"]!, d.address);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const failures: string[] = [];
  try {
    const ownerCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const owner = await ownerCtx.newPage();
    const memberCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const member = await memberCtx.newPage();
    const errors: string[] = []; owner.on("pageerror", (e) => errors.push(`owner ${e.message}`)); member.on("pageerror", (e) => errors.push(`member ${e.message}`));
    const guardO = guardCrashes(owner); const guardM = guardCrashes(member);
    const shot = async (p: import("playwright-core").Page, name: string): Promise<string> => { await p.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))").catch(() => undefined); await p.screenshot({ path: path.join(shots, `${name}.png`) }).catch(() => undefined); return `${name}.png`; };
    const body = async (p: import("playwright-core").Page): Promise<string> => ((await p.evaluate("document.body.innerText").catch(() => "")) as string).replace(/\n+/g, " | ");
    const step = async (name: string, f: () => Promise<Partial<{ result: string; ms: number; shot: string; note: string }> | void>): Promise<void> => {
      const t0 = Date.now();
      try { const r = (await f()) ?? {}; rec.add({ section: "T", step: name, result: r.result ?? "ok", ...(r.ms !== undefined ? { ms: r.ms } : {}), ...(r.shot ? { shot: r.shot } : {}), ...(r.note ? { note: r.note } : {}) }); }
      catch (e) { const msg = (e as Error).message.split("\n")[0]!.slice(0, 300); failures.push(`${name}: ${msg}`); rec.add({ section: "T", step: name, result: `FAIL ${msg}`, ms: Date.now() - t0, shot: await shot(owner, `fail-${failures.length}`), note: (await body(owner)).slice(-250) }); }
    };

    // the owner claims the Space
    const tClaim = await claimInBrowser(owner, d.claim!.replace(d.address, web.origin), { name: "Olivia Owner", username: "olivia", password: PASSWORD });
    const onb = await dismissOnboarding(owner);
    await owner.getByTestId("shell").waitFor({ timeout: 30_000 });
    rec.add({ section: "T", step: "owner claims the Team Space", result: onb ? "setup opened, Finish later" : "ok", ms: tClaim, shot: await shot(owner, "t01-owner-home"), note: (await body(owner)).slice(0, 400) });
    const token = await tokenOf(owner);
    const api = async (cap: string, data: unknown = {}, tok = token, expect = 200): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await ownerCtx.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${tok}` }, data: { idempotencyKey: `g-${cap}-${Math.random().toString(36).slice(2)}`, ...(data as object) } });
      const j = (await r.json().catch(() => ({}))) as { data?: unknown };
      if (expect && r.status() !== expect) throw new Error(`${cap}: ${r.status()} ${JSON.stringify(j).replaceAll(REAL_KEY, "***").slice(0, 300)}`);
      return j.data;
    };
    // the Space's AI key, as the Console's Space AI does it
    await api("providers.space_key.set", { providerKey: "opencode-go", apiKey: REAL_KEY });
    await api("engine.models.list", { refresh: true, wait: true });
    const assistants = (await api("agents.list")).agents as Array<{ agentId: string; name: string }>;
    const assistant = assistants[0]!;
    await api("agents.update", { agentId: assistant.agentId, patch: { model: GATE_MODEL } });
    const home = (await api("channels.home")).channel as { channelId: string; name: string; mainThreadId: string };
    await owner.reload({ waitUntil: "load" }); await owner.getByTestId("shell").waitFor({ timeout: 30_000 });
    await api("channels.agents.add", { channelId: home.channelId, agentId: assistant.agentId, mode: "listen" });

    // invite the member, who joins through the join screens in their own browser
    let memberToken = ""; let memberPerson = "";
    await step("invite a member and the member joins", async () => {
      const roles = (await api("access.roles.list")).roles as Array<{ id: string; name: string }>;
      const made = await api("members.invites.create", { role: roles.find((r) => r.name === "Member")!.id });
      const link = new URL(made.link);
      const t0 = Date.now();
      await member.goto(web.origin + link.pathname + link.hash, { waitUntil: "load" });
      await member.getByTestId("step-accept").waitFor({ timeout: 20_000 });
      const sInvite = await shot(member, "t02-member-invite");
      await member.getByTestId("web").click();
      await member.getByTestId("first").fill("Maya"); await member.getByTestId("last").fill("Lin"); await member.getByTestId("next").click();
      await member.getByTestId("username").fill("maya"); await member.getByTestId("password").fill(PASSWORD); await member.getByTestId("confirm").fill(PASSWORD); await member.getByTestId("next").click();
      await member.getByTestId("device").fill("Gate browser"); await member.getByTestId("next").click();
      await member.getByTestId("ai-none").click(); await shot(member, "t03-member-ai-step");
      const tNext = Date.now();
      await member.getByTestId("next").click();
      await member.getByTestId("shell").waitFor({ timeout: 40_000 });
      const toShell = Date.now() - tNext;
      await dismissOnboarding(member);
      memberToken = await tokenOf(member);
      memberPerson = await member.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].personId as string);
      return { ms: Date.now() - t0, shot: `${sInvite}, ${await shot(member, "t04-member-landed")}`, note: `last step to shell ${toShell} ms; lands: ${(await body(member)).slice(0, 400)}` };
    });
    await guardM.check("after the member joined");

    // the channel: both people, the agent
    const openChannel = async (p: import("playwright-core").Page): Promise<void> => { await p.goto(`${web.origin}/chats`, { waitUntil: "load" }); await p.getByTestId("shell").waitFor({ timeout: 30_000 }); const row = p.getByText(new RegExp(`^#?${home.name}$`)).first(); await row.click({ timeout: 15_000 }); await p.waitForTimeout(1200); };
    await step("both open the first channel", async () => {
      await openChannel(owner); await openChannel(member);
      const s1 = await shot(owner, "t05-owner-channel"); const s2 = await shot(member, "t06-member-channel");
      return { shot: `${s1}, ${s2}`, note: `owner sees: ${(await body(owner)).slice(0, 260)}; member sees: ${(await body(member)).slice(0, 260)}` };
    });
    const msgsOf = async (): Promise<Msg[]> => ((await api("chat.messages.list", { threadId: home.mainThreadId })).messages ?? []) as Msg[];
    const idleTurns = async (): Promise<boolean> => !(((await api("engine.turns.list", { threadId: home.mainThreadId }).catch(() => ({ turns: [] }))).turns ?? []) as Array<{ state: string }>).some((x) => x.state === "running" || x.state === "queued");
    /** After a post: when does each person's screen show the agent's reply (its first words), and when is the turn over. Replies of agents already answered are not counted. */
    const watchBoth = async (agentCountBefore: number, ms = 150_000): Promise<{ owner: number; member: number; done: number; reply: string; author: string }> => {
      const t0 = Date.now(); let o = -1, m = -1, done = -1; let reply = ""; let author = "";
      while (Date.now() - t0 < ms) {
        const a = (await msgsOf()).filter((x) => x.author.kind === "agent" && x.body.trim() !== "");
        if (a.length > agentCountBefore) { reply = a.at(-1)!.body; author = a.at(-1)!.author.id; const head = reply.trim().slice(0, 24);
          if (o < 0 && (await body(owner)).includes(head)) o = Date.now() - t0;
          if (m < 0 && (await body(member)).includes(head)) m = Date.now() - t0; }
        if (o >= 0 && m >= 0 && (await idleTurns())) { done = Date.now() - t0; break; }
        await owner.waitForTimeout(200);
      }
      return { owner: o, member: m, done, reply, author };
    };
    const agentCount = async (): Promise<number> => (await msgsOf()).filter((x) => x.author.kind === "agent" && x.body.trim() !== "").length;
    const dex = (await api("agents.create", { name: "Dex", role: "A teammate who answers in one short sentence.", computer: false })).agent as { agentId: string };
    await api("agents.update", { agentId: dex.agentId, patch: { model: GATE_MODEL } });
    await api("channels.agents.add", { channelId: home.channelId, agentId: dex.agentId, mode: "listen" });
    await step("the owner mentions the agent: both people see the same reply live, the member never reloads", async () => {
      const n0 = await agentCount();
      await api("chat.post", { threadId: home.mainThreadId, body: `@${assistant.name} say hello to the team in one short sentence.`, mentions: [{ kind: "agent", id: assistant.agentId }] });
      const t0 = Date.now();
      const r = await watchBoth(n0);
      const sO = await shot(owner, "t07-owner-after"); const sM = await shot(member, "t08-member-after");
      assert.ok(r.owner >= 0 && r.member >= 0, `both views showed the reply (owner ${r.owner}, member ${r.member})`);
      const mb = await body(member); const label = /Olivia.s Assistant\s*\|?\s*\d/.test(mb) ? "Olivia's Assistant" : /Olivia Owner \(Agent\)/.test(mb) ? "Olivia Owner (Agent)" : "other";
      return { ms: Date.now() - t0, shot: `${sO}, ${sM}`, note: `member's label for the reply author: ${label}; reply on the owner's screen after ${r.owner} ms, on the member's (no reload) after ${r.member} ms, turn over ${r.done} ms; reply: ${r.reply.slice(0, 120)}` };
    });
    await step("the member mentions an agent from their own screen", async () => {
      const n0 = await agentCount();
      await api("chat.post", { threadId: home.mainThreadId, body: "@Dex now say goodbye in one short sentence.", mentions: [{ kind: "agent", id: dex.agentId }] }, memberToken);
      const r = await watchBoth(n0);
      const sO = await shot(owner, "t09-owner-after-member"); const sM = await shot(member, "t10-member-after-member");
      assert.ok(r.owner >= 0 && r.member >= 0, `both views showed it (owner ${r.owner}, member ${r.member})`);
      return { shot: `${sO}, ${sM}`, note: `owner ${r.owner} ms, member ${r.member} ms, turn over ${r.done} ms; reply: ${r.reply.slice(0, 100)}` };
    });

    // two agents in one chat answer in turn
    await step("two agents in one channel answer in turn", async () => {
      const before = await agentCount();
      await api("chat.post", { threadId: home.mainThreadId, body: `@${assistant.name} and @Dex: each of you say your own name in three words.`, mentions: [{ kind: "agent", id: assistant.agentId }, { kind: "agent", id: dex.agentId }] });
      const t0 = Date.now(); let ms: Msg[] = [];
      while (Date.now() - t0 < 150_000) { ms = await msgsOf(); const a = ms.filter((m) => m.author.kind === "agent" && m.body.trim() !== ""); if (a.length >= before + 2 && !((await api("engine.turns.list", { threadId: home.mainThreadId })).turns ?? []).some((x: { state: string }) => x.state === "running" || x.state === "queued")) break; await owner.waitForTimeout(500); }
      const a = ms.filter((m) => m.author.kind === "agent" && m.body.trim() !== "").slice(-2);
      const sO = await shot(owner, "t11-two-agents-owner"); const sM = await shot(member, "t12-two-agents-member");
      assert.equal(new Set(a.map((m) => m.author.id)).size, 2, "two different agents answered");
      return { ms: Date.now() - t0, shot: `${sO}, ${sM}`, note: a.map((m) => m.body.slice(0, 60)).join(" || ") };
    });
    await guardO.check("owner after the channel steps"); await guardM.check("member after the channel steps");

    // the member is removed while their app is open
    await step("remove the member while their app is open: what they see", async () => {
      await member.waitForTimeout(500);
      const t0 = Date.now();
      await api("members.remove", { personId: memberPerson, plan: [], reason: "gate walk" });
      const seen: string[] = []; let signedOutAt = -1;
      for (const wait of [1000, 3000, 6000, 12000]) {
        await member.waitForTimeout(wait - (Date.now() - t0 > wait ? 0 : 0));
        const b = await body(member); seen.push(`${Date.now() - t0} ms: ${b.slice(0, 160)}`);
        if (signedOutAt < 0 && /Sign in to|no longer|removed|access/i.test(b)) signedOutAt = Date.now() - t0;
      }
      const sM = await shot(member, "t13-member-after-removal");
      // a message they try to send
      let sendNote = "";
      try { const f = member.getByTestId("composer-field").first(); if (await f.isVisible().catch(() => false)) { await f.fill("am I still here?"); await f.press("Enter"); await member.waitForTimeout(2500); sendNote = `after sending: ${(await body(member)).slice(0, 200)}`; } } catch { /* no composer */ }
      const sM2 = await shot(member, "t14-member-after-removal-send");
      await member.reload({ waitUntil: "load" }).catch(() => undefined); await member.waitForTimeout(2500);
      const sM3 = await shot(member, "t15-member-after-removal-reload");
      let tryNote = "";
      try { await member.getByTestId("si-user").fill("maya"); await member.getByTestId("si-password").fill(PASSWORD); await member.getByRole("button", { name: "Sign in" }).click(); await member.waitForTimeout(2500); tryNote = `signing in again: ${(await body(member)).slice(0, 220)}`; } catch { /* no sign-in form */ }
      const sM4 = await shot(member, "t16-member-signin-after-removal");
      return { result: signedOutAt >= 0 ? `told after ${signedOutAt} ms` : "NOT TOLD within 22 s", shot: `${sM}, ${sM2}, ${sM3}, ${sM4}`, note: `${seen.join(" // ")}; ${sendNote}; after reload: ${(await body(member)).slice(0, 120)}; ${tryNote}` };
    });
    fs.writeFileSync(path.join(shots, "failures.txt"), failures.join("\n"));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); web.close(); await d.stop(); fs.writeFileSync(path.join(shots, "daemon.log"), d.log().replaceAll(REAL_KEY, "***")); }
  assert.deepEqual(failures, [], "every step of the walk passed");
});
