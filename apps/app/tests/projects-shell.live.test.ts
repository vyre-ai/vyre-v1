// The Projects shell in a real browser against the production export and a claimed daemon (lane l-chrome2a): the Projects group in the Chats sidebar, a project in its own tab with the header and the
// tabs, Plan opening (the regression l-ci21 found), a status set; as the owner (admin) and as Maya (a member joined through the real join screens). Shots (paper, wide and phone) go to VYRE_PROJECTS_SHOTS.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { guardCrashes } from "./crash-guard.ts";

const PASSWORD = "fixture password 123";

/** The review shots: the page in paper, then the same page in graphite (the skin attributes the theme controller sets), then back. */
async function both(p: { screenshot(o: { path: string }): Promise<unknown>; evaluate<T, A>(f: (a: A) => T, a: A): Promise<T>; evaluate<T>(f: () => T): Promise<T>; waitForTimeout(ms: number): Promise<void> }, name: string): Promise<void> {
  const dir = process.env["VYRE_PROJECTS_SHOTS"] ?? "";
  await p.screenshot({ path: path.join(dir, `${name}-paper.png`) });
  const prev = await p.evaluate(() => { const r = document.documentElement; const was = [r.getAttribute("data-skin"), r.getAttribute("data-theme"), r.getAttribute("data-mode")]; for (const k of ["data-skin", "data-theme", "data-mode"]) r.setAttribute(k, "graphite"); return was; });
  await p.waitForTimeout(250);
  await p.screenshot({ path: path.join(dir, `${name}-graphite.png`) });
  await p.evaluate((was) => { const r = document.documentElement; ["data-skin", "data-theme", "data-mode"].forEach((k, i) => { if (was[i] === null) r.removeAttribute(k); else r.setAttribute(k, was[i]!); }); }, prev);
}

test("Projects shell: sidebar group, project tab, header, tabs and status, as an admin and as a member", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const shots = process.env["VYRE_PROJECTS_SHOTS"] ?? "/tmp/vyre-projects-shots"; fs.mkdirSync(shots, { recursive: true });
  const errs: string[] = [];
  try {
    const owner = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await owner.newPage();
    page.on("pageerror", (e) => errs.push(e.message));
    const guards = new Map<unknown, ReturnType<typeof guardCrashes>>();
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Olivia Owner"); await page.getByTestId("claim-username").fill("olivia");
    await page.getByTestId("claim-password").fill(PASSWORD); await page.getByTestId("claim-confirm").fill(PASSWORD);
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click(); await dismissOnboarding(page);
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string);
    const call = async (cap: string, data: unknown): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await owner.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data });
      const body = await r.json();
      assert.equal(r.status(), 200, `${cap}: ${JSON.stringify(body).slice(0, 400)}`);
      return body.data;
    };
    const types = (await call("schema.types.list", {})).types as Array<{ key: string }>;
    const type = (types.find((x) => /project|matter/.test(x.key)) ?? types[0]!).key;
    const made = await call("projects.create", { type, title: "Rivera account", goal: "Close the Rivera engagement", idempotencyKey: "pj-rivera" });
    const pid = made.projectId as string;
    // the page reads these two: ask the Space for them first, so a refusal shows here and not as a blank page
    await call("projects.overview", { projectId: pid }); await call("projects.plan", { projectId: pid });
    await call("projects.create", { type, title: "Q4 billing", idempotencyKey: "pj-q4" });

    // Maya joins through the real join screens, and is made a member of the first project
    const roles = (await call("access.roles.list", {})).roles as { id: string; name: string }[];
    const inv = await call("members.invites.create", { role: roles.find((r) => r.name === "Member")!.id, idempotencyKey: "inv-maya" });
    const joinCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const jp = await joinCtx.newPage();
    const link = new URL(inv.link);
    await jp.goto(web.origin + link.pathname + link.hash);
    await jp.getByTestId("step-accept").waitFor({ timeout: 20_000 });
    await jp.getByTestId("web").click(); await jp.getByTestId("first").fill("Maya"); await jp.getByTestId("last").fill("Lin"); await jp.getByTestId("next").click();
    await jp.getByTestId("username").fill("maya"); await jp.getByTestId("password").fill(PASSWORD); await jp.getByTestId("confirm").fill(PASSWORD); await jp.getByTestId("next").click();
    await jp.getByTestId("device").fill("Maya's browser"); await jp.getByTestId("next").click();
    await jp.getByTestId("ai-none").click(); await jp.getByTestId("next").click();
    await dismissOnboarding(jp);
    const mayaId = await jp.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].personId as string);
    await call("projects.members.set", { projectId: pid, principal: mayaId, role: "member", idempotencyKey: "pj-maya" });

    const walk = async (who: "admin" | "member", p: typeof page, size: "wide" | "phone"): Promise<void> => {
      if (!guards.has(p)) guards.set(p, guardCrashes(p));
      const guard = guards.get(p)!;
      const ok = (where: string): Promise<void> => guard.check(`${who} ${size} ${where}`);
      await p.goto(`${web.origin}/chat`, { waitUntil: "load" });
      if (size === "phone") { await p.getByTestId("mobile-shell").waitFor({ timeout: 30_000 }); } else { await p.getByTestId("shell").waitFor({ timeout: 30_000 }); }
      // a plain chat finishing loading in the Chats tab (React 310 on a chat that loaded after an early return)
      if (who === "admin" && size === "wide") {
        const agents = (await call("agents.list", { limit: 20 })).agents as Array<{ agentId: string }>;
        const chat = (await call("chat.start", { kind: "chat", agentIds: [agents[0]!.agentId], idempotencyKey: "plain-chat" })).thread.threadId as string;
        await p.goto(`${web.origin}/chat#subject=thread:${chat}`, { waitUntil: "load" });
        await p.getByTestId("conversation").waitFor({ timeout: 30_000 }).catch(async (e: Error) => {
          const ids = await p.evaluate(() => [...document.querySelectorAll("[data-testid]")].map((x) => x.getAttribute("data-testid")).slice(0, 40));
          await p.screenshot({ path: path.join(shots, "debug-plain-chat.png") });
          throw new Error(`no conversation at ${p.url()}: ${JSON.stringify(ids)} body=${(await p.locator("body").innerText()).slice(0, 200)} / ${e.message.slice(0, 50)}`);
        });
        await p.waitForTimeout(800);
        assert.equal(await p.getByText("Couldn't draw this page").count(), 0, "a plain chat draws");
        await ok("a plain chat");
        await both(p, `projects-0-plain-chat-${who}-${size}`);
        await p.goto(`${web.origin}/chat`, { waitUntil: "load" });
      }
      // the group in the sidebar, after Goals, and a row
      if (size === "wide") {
        await p.getByTestId("head-projects").waitFor({ timeout: 20_000 });
        await ok("the sidebar");
        await both(p, `projects-1-sidebar-${who}-${size}`);
        await p.getByTestId(`row-pj:${pid}`).click();
      } else {
        await p.goto(`${web.origin}/chat#subject=project:${pid}`, { waitUntil: "load" });
      }
      await p.getByTestId("project-page").waitFor({ timeout: 30_000 }).catch(async (e: Error) => {
        const ids = await p.evaluate(() => [...document.querySelectorAll("[data-testid]")].map((x) => x.getAttribute("data-testid")).filter((x) => /project|chats-|conversation|loading|gone/.test(x ?? "")).slice(0, 30));
        await p.screenshot({ path: path.join(shots, `debug-${who}-${size}.png`) });
        throw new Error(`no project page at ${p.url()}: ${JSON.stringify(ids)} errors=${JSON.stringify(errs.slice(0, 3))} / ${e.message.slice(0, 60)}`);
      });
      assert.equal(await p.getByTestId("project-title").innerText(), "Rivera account");
      await p.getByTestId("conversation").or(p.getByTestId("conversation-loading")).first().waitFor({ timeout: 20_000 }).catch(() => undefined);
      await p.waitForTimeout(800);
      assert.equal(await p.getByText("Couldn't draw this page").count(), 0, "the project page draws with its chat loaded");
      await ok("the project page");
      await both(p, `projects-2-project-${who}-${size}`);
      // the regression: pressing Plan opens the Plan
      await p.getByTestId("tab-plan").click();
      await p.getByTestId("project-plan").waitFor({ timeout: 15_000 }).catch(async (e: Error) => {
        const ids = await p.evaluate(() => [...document.querySelectorAll("[data-testid]")].map((x) => x.getAttribute("data-testid")).filter((x) => /project|tab-|plan|loading|gone/.test(x ?? "")).slice(0, 30));
        await p.screenshot({ path: path.join(shots, `debug-plan-${who}-${size}.png`) });
        throw new Error(`Plan did not open at ${p.url()}: ${JSON.stringify(ids)} body=${(await p.locator("body").innerText()).slice(0, 200)} / ${e.message.slice(0, 40)}`);
      });
      await p.waitForTimeout(500);
      await ok("Plan");
      await both(p, `projects-3-plan-${who}-${size}`);
      for (const k of ["overview", "linked", "knows", "chat"]) { await p.getByTestId(`tab-${k}`).click(); await p.waitForTimeout(500); await ok(`the ${k} tab`); }
      await p.getByTestId("project-chat-main").waitFor({ timeout: 15_000 });
      if (who === "admin" && size === "wide") {
        await p.getByTestId("project-health").click();
        await p.getByTestId("menu-item-At risk").click();
        await p.getByText("At risk").first().waitFor({ timeout: 10_000 });
        await p.getByTestId("tab-knows").click();
        await p.getByTestId("project-knows").waitFor({ timeout: 10_000 });
        await ok("Knows and the status");
        await both(p, `projects-4-knows-${who}-${size}`);
      }
    };
    await walk("admin", page, "wide");
    await page.setViewportSize({ width: 390, height: 844 });
    await walk("admin", page, "phone");
    await walk("member", jp, "wide");
    await jp.setViewportSize({ width: 390, height: 844 });
    await walk("member", jp, "phone");
    assert.deepEqual(errs.filter((e) => !/ResizeObserver/.test(e)), [], "no page errors");
  } finally { await browser.close(); web.close(); await space.stop(); }
});
