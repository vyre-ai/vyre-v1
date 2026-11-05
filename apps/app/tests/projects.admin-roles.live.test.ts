// A Space admin with no Manage on a project changes its roles in a real browser (issue 877, lane l-addsheet-22): against the production export and a claimed daemon, the owner makes a project and leads it,
// Ada joins as an Admin (no grant on the project), Maya as a Member. Ada opens the project, changes Maya's role from the people popover, removes her, and adds her back with the Add people sheet; the grants
// are read back as the owner and Maya's own access follows. Shots (paper and graphite, 1440 wide) go to VYRE_ADMIN_ROLES_SHOTS. A crash or a failed step makes the run red.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { guardCrashes } from "./crash-guard.ts";

const PASSWORD = "fixture password 123";

test("Space admin without Manage: change a role, remove, and add people on a project", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const shots = process.env["VYRE_ADMIN_ROLES_SHOTS"] ?? "/tmp/vyre-admin-roles-shots"; fs.mkdirSync(shots, { recursive: true });
  try {
    const owner = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await owner.newPage();
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Olivia Owner"); await page.getByTestId("claim-username").fill("olivia");
    await page.getByTestId("claim-password").fill(PASSWORD); await page.getByTestId("claim-confirm").fill(PASSWORD);
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click(); await dismissOnboarding(page);
    const tokenOf = (p: typeof page): Promise<string> => p.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string);
    const callAs = async (ctx: typeof owner, token: string, cap: string, data: unknown, expect = 200): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await ctx.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data });
      const body = await r.json();
      assert.equal(r.status(), expect, `${cap}: ${JSON.stringify(body).slice(0, 400)}`);
      return body.data;
    };
    const ownerToken = await tokenOf(page);
    const call = (cap: string, data: unknown): Promise<any> => callAs(owner, ownerToken, cap, data); // eslint-disable-line @typescript-eslint/no-explicit-any
    const types = (await call("schema.types.list", {})).types as Array<{ key: string }>;
    const type = (types.find((x) => /project|matter/.test(x.key)) ?? types[0]!).key;
    const pid = (await call("projects.create", { type, title: "Rivera account", goal: "Close the Rivera engagement", idempotencyKey: "pj-rivera" })).projectId as string;
    const roles = (await call("access.roles.list", {})).roles as { id: string; name: string }[];

    const join = async (roleName: string, first: string, username: string): Promise<{ ctx: typeof owner; page: typeof page; id: string; token: string }> => {
      const inv = await call("members.invites.create", { role: roles.find((r) => r.name === roleName)!.id, idempotencyKey: `inv-${username}` });
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await ctx.newPage();
      const link = new URL(inv.link);
      await p.goto(web.origin + link.pathname + link.hash);
      await p.getByTestId("step-accept").waitFor({ timeout: 20_000 });
      await p.getByTestId("web").click(); await p.getByTestId("first").fill(first); await p.getByTestId("last").fill("Test"); await p.getByTestId("next").click();
      await p.getByTestId("username").fill(username); await p.getByTestId("password").fill(PASSWORD); await p.getByTestId("confirm").fill(PASSWORD); await p.getByTestId("next").click();
      await p.getByTestId("device").fill(`${first}'s browser`); await p.getByTestId("next").click();
      await p.getByTestId("ai-none").click(); await p.getByTestId("next").click();
      await dismissOnboarding(p);
      const id = await p.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].personId as string);
      return { ctx, page: p, id, token: await tokenOf(p) };
    };
    const ada = await join("Admin", "Ada", "ada");
    const maya = await join("Member", "Maya", "maya");
    await call("projects.members.set", { projectId: pid, principal: maya.id, role: "reviewer", idempotencyKey: "pj-maya" });

    // the setup is what the issue describes: Ada is an admin who is not on the project and holds no Manage on it
    const adaMembers = (await callAs(ada.ctx, ada.token, "projects.members.list", { projectId: pid })).members as Array<{ principal: string }>;
    assert.ok(!adaMembers.some((m) => m.principal === ada.id), "Ada is not on the project");

    const p = ada.page;
    const guard = guardCrashes(p);
    const levelOf = async (who: string): Promise<string[]> => {
      const got = (await call("access.shares_of", { resource: { type: "project", id: pid } })).shares as Array<{ grant: { subject: { id: string }; level: string; source?: string } }>;
      return got.filter((s) => s.grant.subject.id === who && s.grant.source === `project:${pid}`).map((s) => s.grant.level);
    };
    assert.deepEqual(await levelOf(maya.id), ["view"], "Maya starts as a reviewer");

    await p.goto(`${web.origin}/chat#subject=project:${pid}`, { waitUntil: "load" });
    await p.getByTestId("project-page").waitFor({ timeout: 30_000 });
    await p.getByTestId("conversation").or(p.getByTestId("conversation-loading")).first().waitFor({ timeout: 20_000 }).catch(() => undefined);
    await p.waitForTimeout(800);
    await guard.check("after the project opened");

    // the people popover with a row's role menu open: the controls an admin gets
    const openRoleMenu = async (): Promise<void> => {
      await p.getByTestId("project-members").click();
      await p.getByTestId("people-popover").waitFor({ timeout: 10_000 });
      await p.getByTestId(`people-row-${maya.id}`).click({ button: "right" });
      await p.getByTestId("menu-item-Change role").waitFor({ timeout: 10_000 });
      await p.getByTestId("menu-item-Remove").waitFor({ timeout: 10_000 });
    };
    await openRoleMenu();
    await guard.check("after the role menu opened");
    // paper, then the same address in graphite (?skin=graphite wins for that view), then back to paper with the menu open again
    const reopen = async (): Promise<void> => {
      await p.getByTestId("project-page").waitFor({ timeout: 30_000 });
      await p.getByTestId("conversation").or(p.getByTestId("conversation-loading")).first().waitFor({ timeout: 20_000 }).catch(() => undefined);
      await p.waitForTimeout(800);
      await openRoleMenu();
      await guard.check("after the role menu reopened");
    };
    await guard.check("before the paper shot");
    await p.screenshot({ path: path.join(shots, "admin-roles-members-paper-1440.png") });
    const here = new URL(p.url());
    const dark = new URL(here); dark.searchParams.set("skin", "graphite");
    await p.goto(dark.toString(), { waitUntil: "load" });
    await reopen();
    await guard.check("before the graphite shot");
    await p.screenshot({ path: path.join(shots, "admin-roles-members-graphite-1440.png") });
    await p.goto(here.toString(), { waitUntil: "load" });
    await reopen();

    // change the role: Reviewer to Member
    await p.getByTestId("menu-item-Change role").click();
    await p.getByTestId("menu-item-Member").click();
    await p.waitForTimeout(800);
    await guard.check("after Change role");
    assert.equal((await call("projects.members.list", { projectId: pid })).members.find((m: { principal: string }) => m.principal === maya.id).role, "member", "the role changed");
    assert.deepEqual(await levelOf(maya.id), ["edit"], "and its grant landed with the project as source");

    // remove her
    await p.keyboard.press("Escape");
    await p.getByTestId("project-members").click().catch(() => undefined);
    await p.getByTestId("people-popover").waitFor({ timeout: 10_000 });
    await p.getByTestId(`people-row-${maya.id}`).click({ button: "right" });
    await p.getByTestId("menu-item-Remove").click();
    await p.waitForTimeout(800);
    await guard.check("after Remove");
    assert.ok(!(await call("projects.members.list", { projectId: pid })).members.some((m: { principal: string }) => m.principal === maya.id), "she is off the project");
    assert.deepEqual(await levelOf(maya.id), [], "and her grants are gone");

    // add her back with the Add people sheet from More
    await p.keyboard.press("Escape");
    await p.getByTestId("project-more").click();
    await p.getByTestId("menu-item-Add People…").click();
    await p.getByTestId(`as-row-person:${maya.id}`).click();
    await p.getByTestId("as-add").click();
    await p.waitForTimeout(1200);
    await guard.check("after Add people");
    assert.equal((await call("projects.members.list", { projectId: pid })).members.find((m: { principal: string }) => m.principal === maya.id)?.role, "member", "the sheet added her as a Member");
    assert.deepEqual(await levelOf(maya.id), ["edit"], "with her grants");
    // Maya's own access follows: she opens the project she was added to
    const mayaOpens = await callAs(maya.ctx, maya.token, "projects.overview", { projectId: pid });
    assert.equal(mayaOpens.project.projectId ?? pid, pid, "Maya opens the project");
    await guard.check("at the end");
    assert.deepEqual(guard.crashes(), [], "no crash");
  } finally { await browser.close(); web.close(); await space.stop(); }
});
