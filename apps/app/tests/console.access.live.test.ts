// Console Access and Agents in Chromium against the production export and a fresh claimed daemon: every flow is driven through the real UI and read back from the server. Screenshots (desktop and phone,
// light "paper" and "graphite" skins) go to VYRE_CONSOLE_ACCESS_SHOTS for review.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright-core";
import { bootFreshSpace, claimOnEdge, edge } from "./real-app-harness.test.ts";

const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "fixture password 123";
const MATRIX = [["paper", "desktop", 1280, 900], ["graphite", "desktop", 1280, 900], ["paper", "phone", 390, 844], ["graphite", "phone", 390, 844]] as const;

test("production Console Access: People directory, person object, groups, devices and bulk actions", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  assert.ok(fs.existsSync(exe), `Chromium is required at ${exe}`);
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shots = process.env["VYRE_CONSOLE_ACCESS_SHOTS"] ?? "/tmp/vyre-console-access-shots"; fs.mkdirSync(shots, { recursive: true });
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Olivia Owner"); await page.getByTestId("claim-username").fill("olivia");
    await page.getByTestId("claim-password").fill(PASSWORD); await page.getByTestId("claim-confirm").fill(PASSWORD);
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click();
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string);
    const call = async (cap: string, data: unknown, bearer = token): Promise<{ status: number; data: any }> => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await context.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${bearer}` }, data });
      return { status: r.status(), data: (await r.json()).data };
    };
    const api = async (cap: string, data: unknown): Promise<any> => { const r = await call(cap, data); assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`); return r.data; }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const roles = (await api("access.roles.list", {})).roles as { id: string; name: string }[];
    const roleId = (name: string): string => roles.find((r) => r.name === name)!.id;
    const join = async (username: string, displayName: string, role = "Member"): Promise<{ personId: string; token: string }> => {
      const inv = await api("members.invites.create", { role: roleId(role), idempotencyKey: `inv-${username}` });
      const code = decodeURIComponent(new URL(inv.link).pathname.split("/").pop()!);
      const r = await context.request.post(`${web.origin}/v1/members/accept`, { data: { code, username, displayName, password: PASSWORD, deviceName: `${displayName.split(" ")[0]}'s laptop`, deviceClass: "desktop", keys: KEYS } });
      assert.equal(r.status(), 200, await r.text()); return (await r.json()).data;
    };
    const maya = await join("maya", "Maya Lin"), noah = await join("noah", "Noah Park", "Developer"), priya = await join("priya", "Priya Rao");
    const sales = (await api("access.groups.create", { name: "Sales", idempotencyKey: "grp-sales" })).group.id as string;
    const support = (await api("access.groups.create", { name: "Support", idempotencyKey: "grp-support" })).group.id as string;
    await api("access.groups.add_member", { groupId: sales, member: { kind: "person", id: maya.personId } });
    const groupOf = async (id: string): Promise<string[]> => ((await api("access.groups.get", { groupId: id })).group.members as { id: string }[]).map((m) => m.id);
    const rolesOf = async (personId: string): Promise<string[]> => (await api("access.principals.get", { principal: { kind: "person", id: personId } })).principal.roles as string[];

    const goPeople = async (p: Page = page): Promise<void> => {
      await p.goto(`${web.origin}/console`, { waitUntil: "load" }); await p.getByTestId("console").waitFor({ timeout: 30_000 });
      const group = p.getByTestId("navgroup-Access"); if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
      await p.getByTestId("row-nav-people").click(); await p.getByTestId("console-people").waitFor();
    };
    const rowOf = (id: string) => page.getByTestId(`row-object-row-console-person-${id}`);
    const pickRow = async (id: string): Promise<void> => { await rowOf(id).click({ button: "right" }); await page.getByRole("menuitem", { name: /^Select$/ }).click(); };
    const matrix = async (name: string, navigate: (p: Page) => Promise<void>): Promise<void> => {
      for (const [skin, size, w, h] of MATRIX) {
        const view = await context.newPage(); await view.setViewportSize({ width: w, height: h });
        await view.goto(`${web.origin}/console?skin=${skin}`, { waitUntil: "load" }); await view.getByTestId("console").waitFor({ timeout: 30_000 });
        await navigate(view); await view.waitForTimeout(250);
        await view.screenshot({ path: path.join(shots, `${name}-${size}-${skin === "paper" ? "light" : "graphite"}.png`), animations: "disabled" }); await view.close();
      }
    };
    /** Phone width has no side navigation: the search button opens the "Go to" list. */
    const goTo = async (p: Page, testId: string, title: string, group: string): Promise<void> => {
      if (p.viewportSize()!.width < 720) { await p.getByTestId("console-search").click(); await p.getByRole("menuitem", { name: title, exact: true }).click(); }
      else { const g = p.getByTestId(`navgroup-${group}`); if ((await g.getAttribute("aria-expanded")) !== "true") await g.click(); await p.getByTestId(`row-nav-${testId}`).click(); }
    };
    const toPeople = async (p: Page): Promise<void> => { await goTo(p, "people", "People", "Access"); await p.getByTestId("console-people").waitFor(); };

    await t.test("the directory lists everyone and narrows by search and by status, role and group together", async () => {
      await goPeople();
      for (const id of [maya.personId, noah.personId, priya.personId]) await rowOf(id).waitFor();
      assert.match(await rowOf(maya.personId).innerText(), /Maya Lin[\s\S]*Active · Member · \d+ groups?/);
      await page.getByTestId("object-list-filter").click(); await page.getByTestId("menu").getByText("Role: Member", { exact: true }).click();
      await rowOf(noah.personId).waitFor({ state: "detached" });
      assert.equal(await rowOf(maya.personId).count() + await rowOf(priya.personId).count(), 2);
      await page.getByTestId("object-list-filter").click(); await page.getByTestId("menu").getByText("Group: Sales", { exact: true }).click();
      await rowOf(priya.personId).waitFor({ state: "detached" });
      assert.equal(await rowOf(maya.personId).count(), 1, "role and group filters narrow together");
      await page.getByTestId("object-list-filter").click(); await page.getByTestId("menu").getByText("Group: Sales", { exact: true }).click();
      await page.getByTestId("object-list-filter").click(); await page.getByTestId("menu").getByText("Role: Member", { exact: true }).click();
      await page.getByTestId("object-list-search").fill("pri"); await rowOf(maya.personId).waitFor({ state: "detached" }); assert.equal(await rowOf(priya.personId).count(), 1);
      await page.getByTestId("object-list-search").fill("");
      await matrix("people-directory", toPeople);
    });

    await t.test("the invite form names the Role, defaults to Member, and Create invite makes a real one-time link", async () => {
      await goPeople();
      assert.equal(await page.getByRole("button", { name: "Role", exact: true }).innerText(), "Member");
      await page.getByRole("button", { name: "Role", exact: true }).click();
      assert.ok(await page.getByRole("menuitem", { name: "Guest", exact: true }).count());
      await page.getByRole("menuitem", { name: "Guest", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "Role", exact: true }).innerText(), "Guest");
      await page.getByTestId("console-invite-create").click(); await page.getByTestId("console-invite-link").waitFor();
      assert.match(await page.getByTestId("console-invite-link").innerText(), /^https?:\/\//);
    });

    await t.test("bulk: add several people to a group and assign a role, each applied and read back", async () => {
      await goPeople();
      await pickRow(maya.personId); await pickRow(priya.personId);
      await page.getByRole("button", { name: "Add to group…", exact: true }).click();
      await page.getByTestId("people-bulk").getByRole("button", { name: "Group", exact: true }).click(); await page.getByRole("menuitem", { name: "Support", exact: true }).click();
      await page.getByTestId("people-bulk-confirm").click();
      await page.getByText(/2 changed/).waitFor();
      assert.deepEqual((await groupOf(support)).sort(), [maya.personId, priya.personId].sort());
      await pickRow(maya.personId); await pickRow(priya.personId);
      await page.getByRole("button", { name: "Assign role…", exact: true }).click();
      await page.getByTestId("people-bulk").getByRole("button", { name: "Role", exact: true }).click(); await page.getByRole("menuitem", { name: "Developer", exact: true }).click();
      await page.getByTestId("people-bulk-confirm").click(); await page.getByText(/2 changed/).waitFor();
      assert.ok((await rolesOf(maya.personId)).includes(roleId("Developer")) && (await rolesOf(priya.personId)).includes(roleId("Developer")));
      await pickRow(maya.personId); await pickRow(priya.personId);
      await page.getByRole("button", { name: "Assign role…", exact: true }).click();
      await page.getByTestId("people-bulk").getByRole("button", { name: "Role", exact: true }).click(); await page.getByRole("menuitem", { name: "Developer", exact: true }).click();
      await page.getByTestId("people-bulk-confirm").click();
      await page.getByText(/0 changed, 2 skipped/).waitFor();
    });

    await t.test("bulk suspend skips the owner, suspends the rest, and ends their sessions", async () => {
      await goPeople();
      await pickRow(noah.personId); await pickRow((await api("identity.whoami", {})).principal.id);
      await page.getByRole("button", { name: "Suspend…", exact: true }).click();
      await page.getByTestId("people-bulk-reason").fill("Contract ended");
      await page.getByTestId("people-bulk-confirm").click();
      await page.getByText(/1 changed, 1 skipped/).waitFor();
      assert.equal((await api("access.principals.get", { principal: { kind: "person", id: noah.personId } })).principal.status, "suspended");
      assert.equal((await call("identity.whoami", {}, noah.token)).status, 401);
      await page.getByTestId("object-list-filter").click(); await page.getByTestId("menu").getByText("Status: Suspended", { exact: true }).click();
      await rowOf(maya.personId).waitFor({ state: "detached" }); assert.equal(await rowOf(noah.personId).count(), 1);
      await api("members.reactivate", { personId: noah.personId });
    });

    await t.test("a person object shows effective access, groups and devices, and changes them", async () => {
      await goPeople(); await rowOf(maya.personId).click();
      await page.getByTestId("person-overview").waitFor();
      await page.getByRole("tab", { name: /^Access/ }).click();
      await page.getByTestId("person-effective").waitFor();
      const effective = await page.getByTestId("person-effective").innerText();
      assert.match(effective, /Roles[\s\S]*Member/); assert.match(effective, /Permissions/);
      await page.getByRole("tab", { name: /^Groups/ }).click(); await page.getByTestId("person-groups").waitFor();
      await page.getByTestId("row-person-group-" + sales).waitFor();
      await page.getByTestId("row-person-group-" + sales).getByRole("button", { name: "Remove" }).click();
      await page.getByText("Removed from group").waitFor();
      assert.ok(!(await groupOf(sales)).includes(maya.personId));
      await page.getByRole("button", { name: "Add to a group", exact: true }).click(); await page.getByRole("menuitem", { name: "Sales", exact: true }).click();
      await page.getByTestId("person-group-add").click(); await page.getByText("Added to group").waitFor();
      assert.ok((await groupOf(sales)).includes(maya.personId));
      await page.getByRole("tab", { name: /^Devices/ }).click(); await page.getByTestId("person-devices").waitFor();
      assert.match(await page.getByTestId("person-devices").innerText(), /Maya's laptop/);
      assert.equal((await call("identity.whoami", {}, maya.token)).status, 200);
      const device = (await api("devices.list", { person: maya.personId })).devices[0].id as string;
      await page.getByTestId("row-person-device-" + device).getByRole("button", { name: "Revoke…" }).click();
      await page.getByTestId("person-device-revoke-confirm-" + device).click(); await page.getByText("Device revoked").waitFor();
      assert.equal((await call("identity.whoami", {}, maya.token)).status, 401, "the revoked device's token stops working");
      await matrix("person-object-access", async (p) => { await toPeople(p); await p.getByTestId(`row-object-row-console-person-${priya.personId}`).click(); await p.getByRole("tab", { name: /^Access/ }).click(); await p.getByTestId("person-effective").waitFor(); });
    });
    await t.test("a grant on one record resolves the record's type and hides the chosen field, enforced for the recipient", async () => {
      const guest = await join("gus", "Gus Hale", "Guest");
      const rec = (await api("records.create", { type: "contact", fields: { name: "Zephyr Quill", phone: "555-0100" }, idempotencyKey: "grant-rec" })).record.id as string;
      let indexed = false; for (let i = 0; i < 100 && !indexed; i++) { const hits = (await api("search.query", { q: "Zephyr", types: ["record"] })).hits as { id: string }[]; indexed = hits.some((h) => h.id === rec); if (!indexed) await new Promise((r) => setTimeout(r, 200)); }
      assert.ok(indexed, "the record reaches the search index " + JSON.stringify(await api("search.query", { q: "Quill" })) + JSON.stringify(await api("search.query", { q: "Zephyr Quill", types: ["record"] })));
      { const got = await api("search.resolve", { kind: "record", itemId: rec }); assert.equal(got.hit?.recordType, "contact", JSON.stringify(got)); }
      assert.equal((await call("records.get", { type: "contact", recordId: rec }, guest.token)).status, 403, "before the grant the guest cannot read it");
      await page.goto(`${web.origin}/console`, { waitUntil: "load" }); await page.getByTestId("console").waitFor({ timeout: 30_000 });
      await goTo(page, "grants", "Grants", "Access"); await page.getByTestId("console-grants").waitFor();
      await page.getByTestId("grant-create-open").click();
      await page.getByRole("button", { name: "Choose resource", exact: true }).click();
      await page.getByTestId("grant-resource-picker").getByRole("button", { name: "Resource kind", exact: true }).click(); await page.getByRole("menuitem", { name: "Records", exact: true }).click();
      await page.getByTestId("grant-resource-picker-search").fill("Zephyr");
      await page.getByText("Zephyr Quill", { exact: true }).first().click();
      await page.getByRole("button", { name: "Choose subject", exact: true }).click();
      await page.getByTestId("row-grant-subject-picker-" + guest.personId).click();
      await page.getByRole("button", { name: "Hidden fields", exact: true }).click(); await page.getByRole("menuitem", { name: "Choose fields to hide", exact: true }).click();
      await page.getByTestId("row-field-phone").waitFor();
      await page.getByTestId("row-field-phone").getByRole("button", { name: "Hide field" }).click();
      await page.getByTestId("grant-add").click(); await page.getByTestId("grant-save-confirm").click();
      await page.getByText("Access granted").first().waitFor();
      const grants = (await api("access.grants.list", { resource: { type: "record", id: rec } })).grants as { subject: { id: string }; conditions: { hiddenFields?: string[] } }[];
      assert.deepEqual(grants.find((g) => g.subject.id === guest.personId)?.conditions.hiddenFields, ["phone"]);
      const seen = await call("records.get", { type: "contact", recordId: rec }, guest.token);
      assert.equal(seen.status, 200); assert.equal(seen.data.record.fields.name, "Zephyr Quill"); assert.equal(seen.data.record.fields.phone, undefined, "the hidden field is not returned");
      assert.match(await page.getByTestId("console-grants").innerText(), /Gus Hale[\s\S]*Zephyr Quill/, "the grant row names the record");
      await matrix("grant-on-record", async (p) => { await goTo(p, "grants", "Grants", "Access"); await p.getByTestId("console-grants").waitFor(); });
    });
    await t.test("an outside actor: create with a role, redeem the one-time token, edit its roles, revoke, and the credential stops working", async () => {
      await page.goto(`${web.origin}/console`, { waitUntil: "load" }); await page.getByTestId("console").waitFor({ timeout: 30_000 });
      await goTo(page, "actors", "Outside actors", "Agents and actors"); await page.getByTestId("console-outside-actors").waitFor();
      await page.getByRole("button", { name: "Name", exact: true }).count();
      await page.getByLabel("Name", { exact: true }).fill("Claude Code"); await page.getByLabel("Provider", { exact: true }).fill("anthropic");
      await page.getByRole("button", { name: "Role", exact: true }).click(); await page.getByRole("menuitem", { name: "Developer", exact: true }).click();
      await page.getByTestId("actor-create").click(); await page.getByTestId("actor-token").waitFor();
      const oneTime = await page.getByTestId("actor-token").innerText();
      const listed = (await api("access.actors.list", {})).actors as { id: string; name: string; status: string; roles: string[] }[];
      const actor = listed.find((a) => a.name === "Claude Code")!;
      assert.equal(actor.status, "pending"); assert.deepEqual(actor.roles, [roleId("Developer")]);
      const redeemed = await context.request.post(`${web.origin}/v1/access/actors/redeem`, { data: { token: oneTime } });
      assert.equal(redeemed.status(), 200, await redeemed.text());
      const credential = (await redeemed.json()).data.credential as string;
      let worked = 0; for (let i = 0; i < 25 && worked !== 200; i++) { worked = (await call("schema.types.list", {}, credential)).status; if (worked !== 200) await new Promise((r) => setTimeout(r, 200)); }
      assert.equal(worked, 200, "the credential signs the tool in as its actor, with the role it was issued");
      assert.equal((await context.request.post(`${web.origin}/v1/access/actors/redeem`, { data: { token: oneTime } })).status() >= 400, true, "the token works once");
      await page.reload({ waitUntil: "load" }); await goTo(page, "actors", "Outside actors", "Agents and actors");
      await page.getByTestId(`row-object-row-${actor.id}`).click();
      await page.getByRole("button", { name: "Edit actor", exact: true }).click();
      await page.getByTestId(`row-actor-role-choice-${roleId("Developer")}`).getByRole("button", { name: "Deselect" }).click();
      await page.getByTestId(`row-actor-role-choice-${roleId("Member")}`).getByRole("button", { name: "Select" }).click();
      await page.getByRole("button", { name: "Save actor", exact: true }).click(); await page.getByText("Actor updated").first().waitFor();
      assert.deepEqual(((await api("access.actors.list", {})).actors as { id: string; roles: string[] }[]).find((a) => a.id === actor.id)!.roles, [roleId("Member")]);
      await page.getByRole("tab", { name: /^Access/ }).click(); await page.getByText("Effective access").first().waitFor();
      await matrix("outside-actor", async (p) => { await goTo(p, "actors", "Outside actors", "Agents and actors"); await p.getByTestId("console-outside-actors").waitFor(); });
      await page.getByTestId("object-more").click(); await page.getByRole("menuitem", { name: "Revoke", exact: true }).click();
      await page.getByTestId("object-confirm-go").click();
      await page.getByText("Actor revoked").first().waitFor();
      assert.equal(((await api("access.actors.list", {})).actors as { id: string; status: string }[]).find((a) => a.id === actor.id)!.status, "revoked");
      assert.equal((await call("schema.types.list", {}, credential)).status, 401, "the revoked credential stops working");
    });
    await t.test("an agent's lifecycle: create, edit model, account and tools, pause and resume, hand over, delete and undo", async () => {
      await page.goto(`${web.origin}/console`, { waitUntil: "load" }); await page.getByTestId("console").waitFor({ timeout: 30_000 });
      await goTo(page, "agents", "Agents register", "Agents and actors"); await page.getByTestId("console-agents").waitFor();
      await page.getByTestId("agent-name").fill("Intake Bot"); await page.getByLabel("Role line", { exact: true }).fill("Use me when a new inquiry arrives.");
      await page.getByLabel("Model (optional)", { exact: true }).fill("model-a");
      await page.getByTestId("agent-create").click(); await page.getByText("Agent created").first().waitFor();
      const agent = ((await api("agents.list", {})).agents as { agentId: string; name: string }[]).find((a) => a.name === "Intake Bot")!;
      const read = async (): Promise<any> => (await api("agents.get", { agentId: agent.agentId })).agent; // eslint-disable-line @typescript-eslint/no-explicit-any
      assert.equal((await read()).model, "model-a"); assert.equal((await read()).ownerId, (await api("identity.whoami", {})).principal.id);
      const openAgent = async (p: Page = page): Promise<void> => { await p.getByTestId(`row-object-row-${agent.agentId}`).click(); await p.getByTestId("object-page-" + agent.agentId).waitFor(); };
      await openAgent();
      await page.getByTestId("object-action-edit").click(); await page.getByTestId("agent-edit-sheet").waitFor();
      await page.getByTestId("agent-edit-model").fill("model-b"); await page.getByLabel("Fallback model", { exact: true }).fill("model-c");
      await page.getByRole("button", { name: "Account", exact: true }).click(); await page.getByRole("menuitem", { name: "A shared key from the Vault", exact: true }).click();
      await page.getByTestId("agent-edit-key").fill("#Team_Anthropic_Key");
      await page.getByLabel("Tools allowed (comma separated)", { exact: true }).fill("records.read, files.read"); await page.getByLabel("Tools denied (comma separated)", { exact: true }).fill("terminal");
      await page.getByTestId("agent-save").click(); await page.getByText("Agent updated").first().waitFor();
      const saved = await read();
      assert.deepEqual([saved.model, saved.fallbackModel, saved.accountPolicy, saved.accountKey, saved.toolsAllowed, saved.toolsDenied], ["model-b", "model-c", "key", "#Team_Anthropic_Key", ["records.read", "files.read"], ["terminal"]]);
      await page.getByRole("tab", { name: /^Configuration/ }).click(); await page.getByTestId("agent-configuration").waitFor();
      const config = await page.getByTestId("agent-configuration").innerText();
      assert.match(config, /model-b/); assert.match(config, /#Team_Anthropic_Key/); assert.match(config, /records\.read, files\.read/); assert.match(config, /terminal/);
      await matrix("agent-configuration", async (p) => { await goTo(p, "agents", "Agents register", "Agents and actors"); await p.getByTestId("console-agents").waitFor(); await openAgent(p); await p.getByRole("tab", { name: /^Configuration/ }).click(); await p.getByTestId("agent-configuration").waitFor(); });
      await page.getByRole("tab", { name: /^Overview/ }).click(); await page.getByTestId("agent-pause-reason").fill("Cost review");
      await page.getByTestId("object-action-pause").click(); await page.getByText("Agent paused").first().waitFor();
      assert.equal((await read()).status, "paused"); assert.equal((await read()).pausedReason, "Cost review");
      await page.getByTestId("object-action-pause").click(); await page.getByText("Agent resumed").first().waitFor();
      assert.notEqual((await read()).status, "paused");
      await page.getByTestId("object-action-edit").click();
      await page.getByRole("button", { name: "Hand over to", exact: true }).click(); await page.getByRole("menuitem", { name: "Maya Lin", exact: true }).click();
      await page.getByTestId("agent-handover-review").click(); await page.getByTestId("agent-handover-confirm").click(); await page.getByText("Agent handed over").first().waitFor();
      assert.equal((await read()).ownerId, maya.personId);
      await page.getByTestId("object-more").click(); await page.getByRole("menuitem", { name: "Delete agent", exact: true }).click(); await page.getByTestId("object-confirm-go").click();
      await page.getByTestId(`row-agent-trashed-${agent.agentId}`).waitFor();
      assert.equal(((await api("agents.list", {})).agents as { agentId: string }[]).some((a) => a.agentId === agent.agentId), false, "a deleted agent leaves the register");
      await page.getByTestId(`agent-undo-${agent.agentId}`).click(); await page.getByText("Agent restored").first().waitFor();
      assert.equal(((await api("agents.list", {})).agents as { agentId: string }[]).some((a) => a.agentId === agent.agentId), true);
      assert.equal((await read()).ownerId, maya.personId, "the restored agent keeps its new owner");
    });
    assert.deepEqual(errors, []);
  } catch (error) {
    await page.screenshot({ path: path.join(shots, "failure.png") }).catch(() => undefined);
    fs.writeFileSync(path.join(shots, "failure.txt"), `${String(error)}\n${await page.locator("body").innerText().catch(() => "")}`);
    throw error;
  } finally { await context.close(); await browser.close(); web.close(); await space.stop(); fs.rmSync(space.dir, { recursive: true, force: true }); }
});
