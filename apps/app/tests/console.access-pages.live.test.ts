// Console Access pages (Groups, Roles, Policies, Reviews) in Chromium against the production export and a fresh claimed daemon: every flow is driven through the real UI and read back from the server. Screenshots (desktop and phone,
// light "paper" and "graphite" skins) go to VYRE_CONSOLE_ACCESS_SHOTS for review.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright-core";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding} from "./real-app-harness.test.ts";

const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "fixture password 123";
const MATRIX = [["paper", "desktop", 1280, 900], ["graphite", "desktop", 1280, 900], ["paper", "phone", 390, 844], ["graphite", "phone", 390, 844]] as const;

test("production Console Access pages: Groups, Roles, Policies and Access reviews", async (t) => {
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
  const shots = process.env["VYRE_CONSOLE_PAGES_SHOTS"] ?? "/tmp/vyre-console-pages-shots"; fs.mkdirSync(shots, { recursive: true });
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Olivia Owner"); await page.getByTestId("claim-username").fill("olivia");
    await page.getByTestId("claim-password").fill(PASSWORD); await page.getByTestId("claim-confirm").fill(PASSWORD);
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click();await dismissOnboarding(page);
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
    /** Wait for the server to show what the UI just did (a note can come and go with the sheet). */
    const eventually = async (read: () => Promise<boolean>, what: string): Promise<void> => { for (let i = 0; i < 60; i++) { if (await read()) return; await new Promise((r) => setTimeout(r, 200)); } assert.fail(what); };
    const goTo = async (p: Page, testId: string, title: string, group: string): Promise<void> => {
      if (p.viewportSize()!.width < 720) { await p.getByTestId("console-search").click(); await p.getByRole("menuitem", { name: title, exact: true }).click(); }
      else { const g = p.getByTestId(`navgroup-${group}`); if ((await g.getAttribute("aria-expanded")) !== "true") await g.click(); await p.getByTestId(`row-nav-${testId}`).click(); }
    };
    const toPeople = async (p: Page): Promise<void> => { await goTo(p, "people", "People", "Access"); await p.getByTestId("console-people").waitFor(); };

    // ---- Groups
    await t.test("Groups: create, rename, add and remove members, change managers, roles, bulk delete", async () => {
      await page.goto(`${web.origin}/console`, { waitUntil: "load" }); await page.getByTestId("console").waitFor({ timeout: 30_000 });
      await goTo(page, "groups", "Groups", "Access"); await page.getByTestId("console-groups").waitFor();
      await page.getByTestId("group-create-open").click(); await page.getByTestId("group-name").fill("Intake team"); await page.getByTestId("group-create").click();
      await page.getByTestId("group-object").waitFor();
      const group = ((await api("access.groups.list", {})).groups as { id: string; name: string }[]).find((g) => g.name === "Intake team")!;
      await page.getByTestId("object-action-members").click();
      await page.getByTestId("group-principal-search").fill("Maya"); await page.getByTestId("row-pick-" + maya.personId).getByRole("button", { name: "Select" }).click(); 
      await page.getByTestId("group-principal-search").fill("Priya"); await page.getByTestId("row-pick-" + priya.personId).getByRole("button", { name: "Select" }).click();
      await eventually(async () => (await groupOf(group.id)).length === 2, "both members were added");
      await page.getByTestId("object-sheet-close").click();
      await page.getByTestId("object-action-edit").click(); await page.getByTestId("group-edit-name").fill("Intake crew"); await page.getByTestId("group-save-name").click(); await eventually(async () => (await api("access.groups.get", { groupId: group.id })).group.name === "Intake crew", "the group is renamed");
      await page.getByTestId("object-action-managers").click();
      await page.getByTestId("group-principal-search").fill("Maya"); await page.getByTestId("row-pick-" + maya.personId).getByRole("button", { name: "Select" }).click();
      await page.getByTestId("group-save-managers").click(); await eventually(async () => ((await api("access.groups.get", { groupId: group.id })).group.managers as { id: string }[]).map((m) => m.id).join() === maya.personId, "Maya manages the group");
      await page.getByRole("tab", { name: /^Members/ }).click();
      await page.getByTestId("row-member-" + priya.personId).getByRole("button", { name: "Remove…" }).click(); await page.getByTestId("group-member-remove-confirm").click(); await eventually(async () => !(await groupOf(group.id)).includes(priya.personId), "Priya was removed");
      await page.getByRole("tab", { name: /^Access/ }).click();
      const dev = roleId("Developer");
      await page.getByTestId("row-group-role-" + dev).getByRole("button", { name: "Assign role…" }).click(); await page.getByTestId("group-role-confirm-" + dev).click(); await eventually(async () => ((await api("access.groups.get", { groupId: group.id })).roles as string[]).includes(dev), "the role was assigned");
      await page.getByRole("tab", { name: /^Activity/ }).click(); await page.getByTestId("object-body").getByText(/rename|details/i).first().waitFor();
      await matrix("group-object", async (p) => { await goTo(p, "groups", "Groups", "Access"); await p.getByTestId("console-groups").waitFor(); await p.getByTestId("row-object-row-" + group.id).click(); await p.getByTestId("group-object").waitFor(); });
      // bulk delete from the list, built-in groups refused
      await page.getByTestId("object-parent").click(); await page.getByTestId("console-groups").waitFor();
      const extra = (await api("access.groups.create", { name: "Temporary", idempotencyKey: "grp-temp" })).group.id as string;
      await page.reload({ waitUntil: "load" }); await goTo(page, "groups", "Groups", "Access");
      for (const id of [extra]) { await page.getByTestId("row-object-row-" + id).click({ button: "right" }); await page.getByRole("menuitem", { name: /^Select$/ }).click(); }
      await page.getByRole("button", { name: "Delete selected custom groups…" }).click(); await page.getByRole("button", { name: "Delete selected groups", exact: true }).click(); await eventually(async () => !((await api("access.groups.list", {})).groups as { id: string }[]).some((g) => g.id === extra), "the group was deleted");
    });
    // ---- Roles
    await t.test("Roles: matrix, clone, stage and apply permissions, clearance, holders, delete", async () => {
      await page.goto(`${web.origin}/console`, { waitUntil: "load" }); await page.getByTestId("console").waitFor({ timeout: 30_000 });
      await goTo(page, "roles", "Roles", "Access"); await page.getByTestId("permission-matrix").waitFor();
      await matrix("roles-matrix", async (p) => { await goTo(p, "roles", "Roles", "Access"); await p.getByTestId("permission-matrix").waitFor(); });
      await page.getByRole("button", { name: "Open Member", exact: true }).click(); await page.getByTestId("role-object").waitFor();
      await page.getByTestId("object-action-clone").click(); await page.getByTestId("role-edit-name").fill("Intake reader"); await page.getByTestId("role-save").click();
      await eventually(async () => ((await api("access.roles.list", {})).roles as { name: string }[]).some((r) => r.name === "Intake reader"), "the role was cloned");
      const cloned = ((await api("access.roles.list", {})).roles as { id: string; name: string; permissions: string[]; clearance: string }[]).find((r) => r.name === "Intake reader")!;
      await goTo(page, "roles", "Roles", "Access"); await page.getByRole("button", { name: "Open Intake reader", exact: true }).click();
      await page.getByRole("tab", { name: /^Permissions/ }).click();
      const dropped = cloned.permissions[0]!;
      await page.getByTestId(`matrix-${cloned.id}-${dropped}`).click(); await page.getByTestId("roles-preview-changes").click(); await page.getByTestId("roles-apply-changes").click();
      await eventually(async () => !((await api("access.roles.get", { roleId: cloned.id })).role.permissions as string[]).includes(dropped), "the permission was removed");
      await page.getByRole("tab", { name: /^Clearance/ }).click(); await page.getByRole("button", { name: "Change clearance", exact: true }).click();
      await page.getByRole("button", { name: "Clearance", exact: true }).click(); await page.getByRole("menuitem", { name: "Public", exact: true }).click(); await page.getByTestId("role-save").click();
      await eventually(async () => (await api("access.roles.get", { roleId: cloned.id })).role.clearance === "public", "the clearance changed");
      await api("access.roles.assign", { subject: { kind: "person", id: priya.personId }, roleId: cloned.id });
      await page.reload({ waitUntil: "load" }); await goTo(page, "roles", "Roles", "Access"); await page.getByRole("button", { name: "Open Intake reader", exact: true }).click();
      await page.getByRole("tab", { name: /^Holders/ }).click(); await page.getByTestId("row-role-holder-" + priya.personId).waitFor();
      await matrix("role-object-holders", async (p) => { await goTo(p, "roles", "Roles", "Access"); await p.getByTestId("permission-matrix").waitFor(); if (p.viewportSize()!.width < 720) { await p.getByRole("button", { name: "Role", exact: true }).click(); await p.getByRole("menuitem", { name: "Intake reader", exact: true }).click(); } await p.getByRole("button", { name: "Open Intake reader", exact: true }).click(); await p.getByRole("tab", { name: /^Holders/ }).click(); await p.getByTestId("row-role-holder-" + priya.personId).waitFor(); });
      // phone: no matrix, one role at a time from the Role menu, its permissions in one column with the toggle at the right
      {
        const phone = await context.newPage(); await phone.setViewportSize({ width: 390, height: 844 });
        await phone.goto(`${web.origin}/console?skin=paper`, { waitUntil: "load" }); await phone.getByTestId("console").waitFor({ timeout: 30_000 });
        await goTo(phone, "roles", "Roles", "Access"); await phone.getByTestId("permission-matrix").waitFor();
        await phone.getByRole("button", { name: "Role", exact: true }).click(); await phone.getByRole("menuitem", { name: "Intake reader", exact: true }).click();
        await phone.getByText("Custom role. Tap a permission to stage a change.").first().waitFor();
        const now = ((await api("access.roles.get", { roleId: cloned.id })).role.permissions as string[]);
        const toggled = now[0]!;
        assert.ok(await phone.getByTestId(`matrix-${cloned.id}-${toggled}`).count(), "the toggle for a permission the role holds is drawn");
        await phone.getByTestId(`matrix-${cloned.id}-${toggled}`).click(); await phone.getByTestId("roles-preview-changes").click(); await phone.getByTestId("roles-apply-changes").click();
        await eventually(async () => !((await api("access.roles.get", { roleId: cloned.id })).role.permissions as string[]).includes(toggled), "the phone toggle changed the role");
        assert.equal(await phone.getByText(/^1 holders?$/).count(), 0);
        for (const [skin, mode] of [["paper", "light"], ["graphite", "graphite"]] as const) { await phone.goto(`${web.origin}/console?skin=${skin}`, { waitUntil: "load" }); await goTo(phone, "roles", "Roles", "Access"); await phone.getByTestId("permission-matrix").waitFor(); await phone.getByRole("button", { name: "Role", exact: true }).click(); await phone.getByRole("menuitem", { name: "Intake reader", exact: true }).click(); await phone.waitForTimeout(300); await phone.screenshot({ path: path.join(shots, `roles-phone-compact-${mode}.png`), animations: "disabled" }); }
        await phone.close();
      }
      // a role with holders cannot be deleted; once they are gone it can
      await page.getByTestId("object-more").click(); await page.getByRole("menuitem", { name: "Delete role", exact: true }).click(); await page.getByTestId("object-confirm-go").click();
      await page.waitForTimeout(600);
      assert.ok(((await api("access.roles.list", {})).roles as { id: string }[]).some((r) => r.id === cloned.id), "a role with a holder is not deleted");
      await api("access.roles.unassign", { subject: { kind: "person", id: priya.personId }, roleId: cloned.id });
      await page.reload({ waitUntil: "load" }); await goTo(page, "roles", "Roles", "Access"); await page.getByRole("button", { name: "Open Intake reader", exact: true }).click();
      await page.getByTestId("object-more").click(); await page.getByRole("menuitem", { name: "Delete role", exact: true }).click(); await page.getByTestId("object-confirm-go").click();
      await eventually(async () => !((await api("access.roles.list", {})).roles as { id: string }[]).some((r) => r.id === cloned.id), "the role was deleted");
    });
    // ---- Policies
    await t.test("Policies: filter, public links policy with review, honest sign-in prerequisites, linked controls, activity", async () => {
      await page.goto(`${web.origin}/console`, { waitUntil: "load" }); await page.getByTestId("console").waitFor({ timeout: 30_000 });
      await goTo(page, "policies", "Policies", "Access"); await page.getByTestId("console-policies").waitFor();
      await page.getByTestId("object-list-filter").click(); await page.getByTestId("menu").getByText("Data", { exact: true }).click();
      await page.getByTestId("row-object-row-retention").waitFor(); assert.equal(await page.getByTestId("row-object-row-sign_in").count(), 0, "the Data filter hides Access policies");
      await page.getByTestId("object-list-filter").click(); await page.getByTestId("menu").getByText("Data", { exact: true }).click();
      await matrix("policies-list", async (p) => { await goTo(p, "policies", "Policies", "Access"); await p.getByTestId("console-policies").waitFor(); });
      // sign-in: required authenticators are not offered while the prerequisites are missing
      await page.getByTestId("row-object-row-sign_in").click(); await page.getByTestId("policy-object").waitFor();
      await page.getByText(/The Space owner must set up an authenticator first|Set up your own authenticator|cannot enroll new members/).first().waitFor();
      await page.getByTestId("object-action-edit").click();
      await page.getByTestId("object-sheet").getByRole("button", { name: "Authenticator requirement", exact: true }).first().click();
      assert.equal(await page.getByRole("menuitem", { name: "Required", exact: true }).count(), 0, "Required is not offered while its prerequisites are missing");
      await page.keyboard.press("Escape"); if (await page.getByTestId("object-sheet-close").count()) await page.getByTestId("object-sheet-close").click();
      await page.getByTestId("object-parent").click();
      // public links
      await page.getByTestId("row-object-row-sharing.public_links").click(); await page.getByTestId("policy-object").waitFor();
      await page.getByTestId("object-action-edit").click();
      await page.getByRole("button", { name: "Who can create new public links", exact: true }).click(); await page.getByRole("menuitem", { name: "Nobody", exact: true }).click();
      await page.getByTestId("policy-links-review").click(); await page.getByTestId("policy-links-confirm").click();
      await eventually(async () => ((await api("access.policies.list", { kind: "sharing" })).policies as { key: string; value: unknown }[]).some((x) => x.key === "sharing.public_links" && x.value === "off"), "the public-link policy is saved");
      await page.getByRole("tab", { name: /^Activity/ }).click(); await page.getByTestId("object-body").getByText(/policies set|policy/i).first().waitFor();
      await matrix("policy-object", async (p) => { await goTo(p, "policies", "Policies", "Access"); await p.getByTestId("console-policies").waitFor(); await p.getByTestId("row-object-row-sharing.public_links").click(); await p.getByTestId("policy-object").waitFor(); });
      // an owned control opens its own page
      await page.getByTestId("object-parent").click(); await page.getByTestId("row-object-row-retention").click(); await page.getByTestId("object-action-open").click();
      await page.getByText(/Retention/).first().waitFor();
    });

    // ---- Access reviews
    await t.test("Access reviews: start, decide grants, close, with review tasks", async () => {
      await page.goto(`${web.origin}/console`, { waitUntil: "load" }); await page.getByTestId("console").waitFor({ timeout: 30_000 });
      const folder = (await api("files.tree", {})).roots.find((r: { key: string }) => r.key === "projects").folderId as string;
      const guest = await join("gus", "Gus Hale", "Guest");
      const made = (await api("files.folder.create", { parentId: folder, name: "Review fixture", idempotencyKey: "rv-folder" })).folder.folderId as string;
      await api("access.share", { resource: { type: "folder", id: made }, subject: { kind: "person", id: maya.personId }, level: "view", idempotencyKey: "rv-g1" });
      await api("access.share", { resource: { type: "folder", id: made }, subject: { kind: "person", id: guest.personId }, level: "view", idempotencyKey: "rv-g2" });
      assert.ok(((await api("access.principals.effective", { principal: { kind: "person", id: guest.personId } })).grants as { resource: { id: string } }[]).some((g) => g.resource.id === made), "the guest holds the grant");
      await goTo(page, "reviews", "Access reviews", "Access"); await page.getByTestId("console-reviews").waitFor();
      await page.getByTestId("review-start-open").click();
      await page.getByRole("button", { name: "Resources to review", exact: true }).click(); await page.getByRole("menuitem", { name: "Folders", exact: true }).click();
      await page.getByTestId("review-start").click();
      let review: { id: string; items: number } | undefined;
      await eventually(async () => { review = ((await api("access.reviews.list", {})).reviews as { id: string; items: number }[])[0]; return !!review && review.items >= 2; }, "a review with the folder grants was started");
      const id = review!.id;
      await page.reload({ waitUntil: "load" }); await goTo(page, "reviews", "Access reviews", "Access"); await page.getByTestId("console-reviews").waitFor();
      await page.getByTestId("row-object-row-" + id).click(); await page.getByTestId("object-header").waitFor();
      await page.getByRole("tab", { name: /^Grants/ }).click();
      const items = (await api("access.reviews.get", { reviewId: id })).items as { grant: { id: string; subject: { id: string } }; decision?: string }[];
      const keep = items.find((i) => i.grant.subject.id === maya.personId)!, drop = items.find((i) => i.grant.subject.id === guest.personId)!;
      await page.getByTestId("row-review-grant-" + keep.grant.id).getByRole("button", { name: "Keep", exact: true }).click();
      await eventually(async () => ((await api("access.reviews.get", { reviewId: id })).items as { grant: { id: string }; decision?: string }[]).find((i) => i.grant.id === keep.grant.id)?.decision === "keep", "the grant was kept");
      await page.getByTestId("row-review-grant-" + drop.grant.id).click();
      await page.getByRole("button", { name: "Remove selected…" }).click(); await page.getByRole("button", { name: "Remove selected grants", exact: true }).click();
      await eventually(async () => !((await api("access.grants.list", { resource: { type: "folder", id: made } })).grants as { id: string }[]).some((g) => g.id === drop.grant.id), "the removed grant ended");
      assert.ok(!((await api("access.principals.effective", { principal: { kind: "person", id: guest.personId } })).grants as { resource: { id: string } }[]).some((g) => g.resource.id === made), "the person whose grant was removed no longer holds it");
      await page.getByRole("tab", { name: /^Review tasks/ }).click();
      await page.getByRole("tab", { name: /^Activity/ }).click(); await page.getByTestId("object-body").getByText(/review/i).first().waitFor();
      await matrix("review-object", async (p) => { await goTo(p, "reviews", "Access reviews", "Access"); await p.getByTestId("console-reviews").waitFor(); await p.getByTestId("row-object-row-" + id).click(); await p.getByTestId("object-header").waitFor(); await p.getByRole("tab", { name: /^Grants/ }).click(); });
      await page.getByTestId("object-more").click(); await page.getByRole("menuitem", { name: "Close review", exact: true }).click(); await page.getByTestId("object-confirm-go").click();
      await eventually(async () => ((await api("access.reviews.get", { reviewId: id })).review as { state: string }).state === "closed", "the review closed");
    });
    assert.deepEqual(errors, []);
  } catch (error) {
    await page.screenshot({ path: path.join(shots, "failure.png") }).catch(() => undefined);
    fs.writeFileSync(path.join(shots, "failure.txt"), `${String(error)}\n${await page.locator("body").innerText().catch(() => "")}`);
    throw error;
  } finally { await context.close(); await browser.close(); web.close(); await space.stop(); fs.rmSync(space.dir, { recursive: true, force: true }); }
});
