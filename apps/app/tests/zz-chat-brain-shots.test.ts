import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootFreshSpace, claimOnEdge, edge } from "./real-app-harness.test.ts";
import { vendor } from "../../../fixtures/model-vendor.ts";

const PRELOAD = fileURLToPath(new URL("../../../fixtures/model-vendor-preload.mjs", import.meta.url));
const KEY = "sk-test-fixture-0123456789abcdef"; // secret-scan: fake
const OUT = process.env["SHOTS_OUT"] ?? "/tmp/chat-brain-shots";

test("shots", { timeout: 600_000 }, async () => {
  const dist = process.env["VYRE_APP_DIST"]!;
  const { chromium } = await import("playwright-core");
  const v = await vendor();
  const prior = process.env["NODE_OPTIONS"];
  process.env["NODE_OPTIONS"] = `${prior ?? ""} --import ${PRELOAD}`.trim();
  process.env["VYRE_TEST_VENDOR"] = v.base;
  const space = await bootFreshSpace(undefined, true);
  if (prior === undefined) delete process.env["NODE_OPTIONS"]; else process.env["NODE_OPTIONS"] = prior;
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: process.env["CHROME_BIN"] || chromium.executablePath(), args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1640, height: 900 } });
  const page = await context.newPage();
  fs.mkdirSync(OUT, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const notes: string[] = [];
  const shot = async (name: string): Promise<void> => { await page.screenshot({ path: path.join(OUT, `${name}.png`) }); };
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Olivia Park"); await page.getByTestId("claim-username").fill("olivia");
    await page.getByTestId("claim-password").fill("fixture password 123"); await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click();
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string);
    const api = async (cap: string, data: unknown): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await context.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data });
      assert.equal(r.status(), 200, `${cap}: ${await r.text()}`); return (await r.json()).data;
    };
    const provider = await api("providers.add", { idempotencyKey: "p1", providerKey: "openai", connection: "api_key", apiKey: KEY, scope: "mine" });
    await api("providers.set_space_use", { idempotencyKey: "p2", providerId: provider.provider.id, allow: true });
    const billing = (await api("agents.create", { name: "Billing", role: "You answer questions about invoices and files.", model: "gpt-4o-mini", idempotencyKey: "a1" })).agent.agentId as string;
    const checker = (await api("agents.create", { name: "Checker", role: "You check other agents' work.", model: "gpt-4o-mini", idempotencyKey: "a2" })).agent.agentId as string;
    const assistant = (await api("agents.create", { name: "Assistant", role: "You are the person's private assistant.", model: "gpt-4o-mini", idempotencyKey: "a3" })).agent.agentId as string;
    const connected = await context.request.post(`${web.origin}/v1/connections/create`, { headers: { authorization: `Bearer ${token}` }, data: { connector: "openai", title: "OpenAI", ownerKind: "person", idempotencyKey: "c1" } });
    notes.push(`connections.create openai: ${connected.status()} ${(await connected.text()).slice(0, 300)}`);
    const people = await api("access.principals.list", { limit: 50 });
    const me = (people.principals as Array<{ id: string; name: string; kind: string }>).find((x) => x.kind === "person" && /Olivia/.test(x.name))!.id;
    const run = (await api("runs.start", { kind: "other", name: "Weekly invoice check", owner: me, idempotencyKey: "run1" })).runId as string;
    const rec = (await api("records.create", { type: "contact", fields: { name: "Maya Chen", email: "maya.chen@example.com", phone: "555-0101" }, idempotencyKey: "r1" })).record.id as string;
    const task = (await api("tasks.create", { kind: "work", title: "Send Maya the lease letter", summary: "Draft and send the letter about her notice period.", assigned: { kind: "agent", id: billing }, idempotencyKey: "t1" })).task.id as string;
    const talk = async (agent: string, title: string, body: string, key: string, extra: Record<string, unknown> = {}): Promise<string> => {
      const t = (await api("chat.start", { kind: "chat", agentIds: [agent], title, idempotencyKey: `s-${key}`, ...extra })).thread.threadId as string;
      await api("chat.post", { threadId: t, body, mentions: [{ kind: "agent", id: agent }], idempotencyKey: `p-${key}` });
      return t;
    };
    const open = async (t: string): Promise<void> => {
      await page.goto(`${web.origin}/chat`, { waitUntil: "load" });
      await page.waitForTimeout(2000);
      await page.evaluate((id) => { location.hash = `screen=chats.conversation&threadId=${id}`; }, t);
      await page.waitForTimeout(4500);
    };
    v.script.push({ text: "Ready." });
    const warm = await talk(billing, "Warm up", "Are you there?", "warm");
    await open(warm);
    await page.waitForTimeout(3000);
    const ca = await context.request.post(`${web.origin}/v1/console/assistant_open`, { headers: { authorization: `Bearer ${token}` }, data: { page: "access.checker", idempotencyKey: "ca1" } });
    notes.push(`console.assistant_open: ${ca.status()} ${(await ca.text()).slice(0, 400)}`);
    await page.route("**/v1/connections/list", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { connections: [{ id: "con_ai", connector: "openai", title: "OpenAI", state: "active", ownerKind: "person" }] } }) }));
    const rr = await context.request.post(`${web.origin}/v1/chat/start`, { headers: { authorization: `Bearer ${token}` }, data: { kind: "chat", agentIds: [billing], title: "probe run", scopeType: "run", scopeId: run, idempotencyKey: "probe-run" } });
    notes.push(`run chat.start: ${rr.status()} ${(await rr.text()).slice(0, 300)}`);
    for (const mode of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: mode });
      // 1. The Undo card: the agent changes Maya's phone, the card lists it with one Undo
      await page.setViewportSize({ width: 1640, height: 900 });
      v.script.push({ tool: { name: "records_update", args: { type: "contact", recordId: rec, patch: { phone: `555-02${mode === "light" ? "11" : "22"}` } } } }, { text: "I changed Maya Chen's phone number." });
      const u = await talk(billing, `Update Maya ${mode}`, "Change Maya Chen's phone number.", `u-${mode}`);
      await open(u);
      await page.locator('[data-testid^="turnchanges-"]').first().waitFor({ timeout: 20_000 }).catch(() => notes.push(`no undo card ${mode}`));
      await shot(`undo-card-${mode}`);
      const undoBtn = page.getByRole("button", { name: /^Undo$/ }).first();
      notes.push(`undo button ${mode}: ${await undoBtn.count()}`);
      if (mode === "light" && (await undoBtn.count())) { await undoBtn.click(); await page.waitForTimeout(1500); await shot(`undo-done-${mode}`); }
      // 2. Home Ask box
      await page.goto(`${web.origin}/home`, { waitUntil: "load" });
      await page.waitForTimeout(3500);
      await shot(`home-ask-${mode}`);
      const box = page.getByTestId("ask-box");
      if (await box.count()) {
        v.script.push({ text: "You have one open task: Send Maya the lease letter." });
        await box.click(); await page.keyboard.type("What is on my plate?"); await page.keyboard.press("Enter"); await page.waitForTimeout(5000); await shot(`home-ask-thread-${mode}`);
      } else notes.push(`no ask-box on home ${mode}`);
      // 3. Console assistant
      await page.goto(`${web.origin}/console#screen=access.checker&page=checker`, { waitUntil: "load" });
      await page.waitForTimeout(3000);
      const tog = page.getByTestId("console-assistant-toggle");
      const on = page.getByRole("button", { name: "Assistant" });
      if (await on.count()) { const pressed = await on.first().getAttribute("aria-pressed"); if (pressed !== "true") await on.first().click(); await page.waitForTimeout(3500); }
      await shot(`console-assistant-${mode}`);
      void tog;
      // 4. Record workspace
      v.script.push({ text: "Hello Olivia. I have Maya Chen's page open beside this chat." });
      const w = await talk(billing, `Maya Chen follow-up ${mode}`, "Hello", `w-${mode}`, { recordId: rec });
      await open(w);
      await shot(`workspace-record-${mode}`);
      // 5. The drawer below 1500px
      await page.setViewportSize({ width: 1360, height: 860 });
      await page.waitForTimeout(1500);
      await shot(`workspace-drawer-open-${mode}`);
      const hide = page.getByTestId("chats-drawer-toggle");
      if (await hide.count()) { await hide.click(); await page.waitForTimeout(800); await shot(`workspace-drawer-closed-${mode}`); } else notes.push(`no drawer toggle ${mode}`);
      await page.setViewportSize({ width: 1640, height: 900 });
      // 6. Task workspace
      v.script.push({ text: "I will draft the letter now." });
      const tk = await talk(billing, `Task chat ${mode}`, "How is this going?", `tk-${mode}`, { scopeType: "task", scopeId: task });
      await open(tk);
      await shot(`workspace-task-${mode}`);
      // 7. Run workspace: the newest run of the Space
      v.script.push({ text: "That run is still queued." });
      const rt = await talk(billing, `Run chat ${mode}`, "What is the state of this run?", `rn-${mode}`, { scopeType: "run", scopeId: run });
      await open(rt);
      await shot(`workspace-run-${mode}`);
      // 8. The quiet hand-off line: the lead pulls in Checker
      v.script.push({ text: "@Checker can you look at the lease notice period?" }, { text: "The 30 days notice matches the lease." }, { text: "Thanks, Checker." });
      const h = (await api("chat.start", { kind: "chat", agentIds: [billing], title: `Lease review ${mode}`, idempotencyKey: `h-${mode}` })).thread.threadId as string;
      await api("threads.add_agent", { threadId: h, agentId: checker, idempotencyKey: `ha-${mode}` });
      await api("chat.post", { threadId: h, body: "Is the notice period in the lease right?", mentions: [{ kind: "agent", id: billing }], idempotencyKey: `hp-${mode}` });
      await page.waitForTimeout(6000);
      await open(h);
      await shot(`handoff-line-${mode}`);
    }
    fs.writeFileSync(path.join(OUT, "notes.txt"), `errors ${JSON.stringify(errors)}\n${notes.join("\n")}\n`);
  } finally { await context.close(); await browser.close(); web.close(); await space.stop(); fs.rmSync(space.dir, { recursive: true, force: true }); v.close(); }
});
