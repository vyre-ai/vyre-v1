// Console Access and Agents in Chromium against the production export and a fresh claimed daemon: every flow is driven through the real UI and read back from the server. Screenshots (desktop and phone,
// light "paper" and "graphite" skins) go to VYRE_CONSOLE_ACCESS_SHOTS for review.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright-core";
import { openConsolePage } from "./console-nav.ts";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";

const KEYS = {
  personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk",
  publicKey: "cHVibGljLWtleQ==",
  privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk",
  spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }],
};
const PASSWORD = "fixture password 123";
/** The Model pickers list the models the Space's connected accounts offer; a Space with no account has only the default. The test checks the picker reads the saved model back. */
async function pickerReads(page: Page, label: string, text: string): Promise<void> {
  await page.getByRole("button", { name: label, exact: true }).waitFor();
  assert.match(
    await page.getByRole("button", { name: label, exact: true }).innerText(),
    new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `${label} shows ${text}`,
  );
}
// the Console opens on a computer (owner ruling, 3 Nov 2026): a phone draws no Console page, so the screenshots are desktop only, in light and graphite
const MATRIX = [
  ["paper", "desktop", 1280, 900],
  ["graphite", "desktop", 1280, 900],
] as const;

test("production Console Access: outside agents and the agent lifecycle", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required");
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return;
  }
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
  const shots = process.env["VYRE_CONSOLE_ACCESS_SHOTS"] ?? "/tmp/vyre-console-access-shots";
  fs.mkdirSync(shots, { recursive: true });
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Olivia Owner");
    await page.getByTestId("claim-username").fill("olivia");
    await page.getByTestId("claim-password").fill(PASSWORD);
    await page.getByTestId("claim-confirm").fill(PASSWORD);
    await page.getByTestId("claim-next").click();
    await page.getByTestId("claim-create").click();
    await dismissOnboarding(page);
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string,
    );
    const call = async (cap: string, data: unknown, bearer = token): Promise<{ status: number; data: any }> => {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await context.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, {
        headers: { authorization: `Bearer ${bearer}` },
        data,
      });
      return { status: r.status(), data: (await r.json()).data };
    };
    const api = async (cap: string, data: unknown): Promise<any> => {
      const r = await call(cap, data);
      assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
      return r.data;
    }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const roles = (await api("access.roles.list", {})).roles as { id: string; name: string }[];
    const roleId = (name: string): string => roles.find((r) => r.name === name)!.id;
    const join = async (
      username: string,
      displayName: string,
      role = "Member",
    ): Promise<{ personId: string; token: string }> => {
      const inv = await api("members.invites.create", { role: roleId(role), idempotencyKey: `inv-${username}` });
      const code = decodeURIComponent(new URL(inv.link).pathname.split("/").pop()!);
      const r = await context.request.post(`${web.origin}/v1/members/accept`, {
        data: {
          code,
          username,
          displayName,
          password: PASSWORD,
          deviceName: `${displayName.split(" ")[0]}'s laptop`,
          deviceClass: "desktop",
          keys: KEYS,
        },
      });
      assert.equal(r.status(), 200, await r.text());
      return (await r.json()).data;
    };
    const maya = await join("maya", "Maya Lin"),
      noah = await join("noah", "Noah Park", "Developer"),
      priya = await join("priya", "Priya Rao");
    const sales = (await api("access.groups.create", { name: "Sales", idempotencyKey: "grp-sales" })).group
      .id as string;
    const support = (await api("access.groups.create", { name: "Support", idempotencyKey: "grp-support" })).group
      .id as string;
    await api("access.groups.add_member", { groupId: sales, member: { kind: "person", id: maya.personId } });
    const groupOf = async (id: string): Promise<string[]> =>
      ((await api("access.groups.get", { groupId: id })).group.members as { id: string }[]).map((m) => m.id);
    const rolesOf = async (personId: string): Promise<string[]> =>
      (await api("access.principals.get", { principal: { kind: "person", id: personId } })).principal.roles as string[];

    /** Reach a Console page through the real navigation: the place in the side list, then its tab, then the view under the tab's text switch. A phone has no Console (it opens on a computer), so every flow here runs at desktop width. */
    const goPage = async (p: Page, pageId: string): Promise<void> => {
      await openConsolePage(p, pageId);
    };
    const goPeople = async (p: Page = page): Promise<void> => {
      await p.goto(`${web.origin}/console`, { waitUntil: "load" });
      await p.getByTestId("console").waitFor({ timeout: 30_000 });
      await goPage(p, "people");
      await p.getByTestId("console-people").waitFor();
    };
    const rowOf = (id: string) => page.getByTestId(`row-object-row-console-person-${id}`);
    const pickRow = async (id: string): Promise<void> => {
      await rowOf(id).click({ button: "right" });
      await page.getByRole("menuitem", { name: /^Select$/ }).click();
    };
    const matrix = async (name: string, navigate: (p: Page) => Promise<void>): Promise<void> => {
      for (const [skin, size, w, h] of MATRIX) {
        const view = await context.newPage();
        await view.setViewportSize({ width: w, height: h });
        await view.goto(`${web.origin}/console?skin=${skin}`, { waitUntil: "load" });
        // the Console opens on a computer: a phone shows that line and a way to chat about it (mobile-map.ts desktopLine), so a phone has no Console page to navigate
        if (w < 720) await view.getByText(/The Console opens on a computer/).waitFor({ timeout: 30_000 });
        else {
          await view.getByTestId("console").waitFor({ timeout: 30_000 });
          await navigate(view);
        }
        await view.waitForTimeout(250);
        await view.screenshot({
          path: path.join(shots, `${name}-${size}-${skin === "paper" ? "light" : "graphite"}.png`),
          animations: "disabled",
        });
        await view.close();
      }
    };
    const toPeople = async (p: Page): Promise<void> => {
      await goPage(p, "people");
      await p.getByTestId("console-people").waitFor();
    };

    await t.test(
      "an outside agent: create with a role, redeem the one-time token, edit its roles, revoke, and the credential stops working",
      async () => {
        await page.goto(`${web.origin}/console`, { waitUntil: "load" });
        await page.getByTestId("console").waitFor({ timeout: 30_000 });
        await goPage(page, "actors");
        await page.getByTestId("console-outside-actors").waitFor();
        // Connect a tool (Agents, Outside agents) opens a sheet: name, provider and role, then Issue token makes the one-time token
        await page.getByTestId("actor-new").click();
        const sheet = page.getByRole("dialog");
        await sheet.getByLabel("Name", { exact: true }).fill("Claude Code");
        await page.getByRole("button", { name: "Provider", exact: true }).click();
        await page.getByRole("menuitem", { name: "Anthropic", exact: true }).click();
        await page.getByRole("button", { name: "Role", exact: true }).click();
        await page.getByRole("menuitem", { name: "Developer", exact: true }).click();
        await sheet.getByRole("button", { name: "Issue token", exact: true }).click();
        await page.getByTestId("actor-token").waitFor();
        const oneTime = await page.getByTestId("actor-token").innerText();
        await sheet.getByRole("button", { name: "Done", exact: true }).click();
        const listed = (await api("access.actors.list", {})).actors as {
          id: string;
          name: string;
          status: string;
          roles: string[];
        }[];
        const actor = listed.find((a) => a.name === "Claude Code")!;
        assert.match(
          await page.getByTestId(`row-object-row-${actor.id}`).innerText(),
          /Anthropic · Pending/,
          "the row reads Provider · Status",
        );
        assert.equal(actor.status, "pending");
        assert.deepEqual(actor.roles, [roleId("Developer")]);
        const redeemed = await context.request.post(`${web.origin}/v1/access/actors/redeem`, {
          data: { token: oneTime },
        });
        assert.equal(redeemed.status(), 200, await redeemed.text());
        const credential = (await redeemed.json()).data.credential as string;
        let worked = 0;
        for (let i = 0; i < 25 && worked !== 200; i++) {
          worked = (await call("schema.types.list", {}, credential)).status;
          if (worked !== 200) await new Promise((r) => setTimeout(r, 200));
        }
        assert.equal(worked, 200, "the credential signs the tool in as its actor, with the role it was issued");
        assert.equal(
          (
            await context.request.post(`${web.origin}/v1/access/actors/redeem`, { data: { token: oneTime } })
          ).status() >= 400,
          true,
          "the token works once",
        );
        await page.reload({ waitUntil: "load" });
        await goPage(page, "actors");
        await page.getByTestId(`row-object-row-${actor.id}`).click();
        await page.getByRole("button", { name: "Edit outside agent", exact: true }).click();
        await page
          .getByTestId(`row-actor-role-choice-${roleId("Developer")}`)
          .getByRole("button", { name: "Deselect" })
          .click();
        await page
          .getByTestId(`row-actor-role-choice-${roleId("Member")}`)
          .getByRole("button", { name: "Select" })
          .click();
        await page.getByRole("button", { name: "Save outside agent", exact: true }).click();
        await page.getByText("Outside agent updated").first().waitFor();
        assert.deepEqual(
          ((await api("access.actors.list", {})).actors as { id: string; roles: string[] }[]).find(
            (a) => a.id === actor.id,
          )!.roles,
          [roleId("Member")],
        );
        await page.getByRole("tab", { name: /^Access/ }).click();
        await page.getByText("Effective access").first().waitFor();
        await matrix("outside-actor", async (p) => {
          await goPage(p, "actors");
          await p.getByTestId("console-outside-actors").waitFor();
        });
        await page.getByTestId("object-more").click();
        await page.getByRole("menuitem", { name: "Revoke", exact: true }).click();
        await page.getByTestId("object-confirm-go").click();
        await page.getByText("Outside agent revoked").first().waitFor();
        assert.equal(
          ((await api("access.actors.list", {})).actors as { id: string; status: string }[]).find(
            (a) => a.id === actor.id,
          )!.status,
          "revoked",
        );
        assert.equal(
          (await call("schema.types.list", {}, credential)).status,
          401,
          "the revoked credential stops working",
        );
      },
    );
    await t.test(
      "an agent's lifecycle: create, edit model, account and tools, pause and resume, hand over, delete and undo",
      async () => {
        await page.goto(`${web.origin}/console`, { waitUntil: "load" });
        await page.getByTestId("console").waitFor({ timeout: 30_000 });
        await goPage(page, "agents");
        await page.getByTestId("console-agents").waitFor();
        // New agent opens a sheet
        await page.getByTestId("agent-new").click();
        await page.getByTestId("agent-new-sheet").waitFor();
        await page.getByTestId("agent-name").fill("Intake Bot");
        await page.getByLabel("Role line", { exact: true }).fill("Use me when a new inquiry arrives.");
        // the model is a picker of the models the Space can run; this Space has no connected account, so the picker offers only Default
        await page.getByRole("button", { name: "Model", exact: true }).click();
        await page.getByRole("menuitem").first().waitFor();
        assert.equal(await page.getByRole("menuitem").count(), 1, "only Default is offered with no account connected");
        await page.getByRole("menuitem").first().click();
        await page.getByTestId("agent-new-sheet").getByRole("button", { name: "Create", exact: true }).click();
        await page.getByText("Agent created").first().waitFor();
        const agent = ((await api("agents.list", {})).agents as { agentId: string; name: string }[]).find(
          (a) => a.name === "Intake Bot",
        )!;
        const read = async (): Promise<any> => (await api("agents.get", { agentId: agent.agentId })).agent; // eslint-disable-line @typescript-eslint/no-explicit-any
        assert.ok(!(await read()).model, "Default is saved as no model");
        assert.equal((await read()).ownerId, (await api("identity.whoami", {})).principal.id);
        const openAgent = async (p: Page = page): Promise<void> => {
          await p.getByTestId(`row-object-row-${agent.agentId}`).click();
          await p.getByTestId("object-page-" + agent.agentId).waitFor();
        };
        await api("agents.update", { agentId: agent.agentId, patch: { model: "model-b", fallbackModel: "model-c" } });
        await page.reload({ waitUntil: "load" });
        await goPage(page, "agents");
        await page.getByTestId("console-agents").waitFor();
        await openAgent();
        await page.getByTestId("object-action-edit").click();
        await page.getByTestId("agent-edit-sheet").waitFor();
        // models set through the capability still show in the picker, listed or not
        await pickerReads(page, "Model", "model-b");
        await pickerReads(page, "Fallback model", "model-c");
        await page.getByRole("button", { name: "Account", exact: true }).click();
        await page.getByRole("menuitem", { name: "A shared key from the Vault", exact: true }).click();
        await page.getByTestId("agent-edit-key").fill("#Team_Anthropic_Key");
        await page.getByLabel("Tools allowed (comma separated)", { exact: true }).fill("records.read, files.read");
        await page.getByLabel("Tools denied (comma separated)", { exact: true }).fill("terminal");
        await page.getByTestId("agent-save").click();
        await page.getByText("Agent updated").first().waitFor();
        const saved = await read();
        assert.equal(saved.model, "model-b", "the model set through the capability is kept");
        assert.equal(saved.fallbackModel, "model-c");
        assert.deepEqual(
          [saved.accountPolicy, saved.accountKey, saved.toolsAllowed, saved.toolsDenied],
          ["key", "#Team_Anthropic_Key", ["records.read", "files.read"], ["terminal"]],
        );
        await page.getByRole("tab", { name: /^Configuration/ }).click();
        await page.getByTestId("agent-configuration").waitFor();
        const config = await page.getByTestId("agent-configuration").innerText();
        assert.ok(config.includes(saved.model));
        assert.match(config, /#Team_Anthropic_Key/);
        assert.match(config, /records\.read, files\.read/);
        assert.match(config, /terminal/);
        await matrix("agent-configuration", async (p) => {
          await goPage(p, "agents");
          await p.getByTestId("console-agents").waitFor();
          await openAgent(p);
          await p.getByRole("tab", { name: /^Configuration/ }).click();
          await p.getByTestId("agent-configuration").waitFor();
        });
        await page.getByRole("tab", { name: /^Overview/ }).click();
        // the reason is asked for after Pause is pressed (a small dialog), not on the Overview before it (walker, 15 Nov): press Pause, write the reason, confirm
        await page.getByTestId("object-action-pause").click();
        await page.getByTestId("agent-pause-reason").fill("Cost review");
        await page.getByTestId("agent-pause-confirm").click();
        await page.getByText("Agent paused").first().waitFor();
        assert.equal((await read()).status, "paused");
        assert.equal((await read()).pausedReason, "Cost review");
        await page.getByTestId("object-action-pause").click();
        await page.getByText("Agent resumed").first().waitFor();
        assert.notEqual((await read()).status, "paused");
        await page.getByTestId("object-action-edit").click();
        await page.getByRole("button", { name: "Hand over to", exact: true }).click();
        await page.getByRole("menuitem", { name: "Maya Lin", exact: true }).click();
        await page.getByTestId("agent-handover-review").click();
        await page.getByTestId("agent-handover-confirm").click();
        await page.getByText("Agent handed over").first().waitFor();
        assert.equal((await read()).ownerId, maya.personId);
        await page.getByTestId("object-more").click();
        await page.getByRole("menuitem", { name: "Delete agent", exact: true }).click();
        await page.getByTestId("object-confirm-go").click();
        await page.getByTestId(`row-agent-trashed-${agent.agentId}`).waitFor();
        assert.equal(
          ((await api("agents.list", {})).agents as { agentId: string }[]).some((a) => a.agentId === agent.agentId),
          false,
          "a deleted agent leaves the register",
        );
        await page.getByTestId(`agent-undo-${agent.agentId}`).click();
        await page.getByText("Agent restored").first().waitFor();
        assert.equal(
          ((await api("agents.list", {})).agents as { agentId: string }[]).some((a) => a.agentId === agent.agentId),
          true,
        );
        assert.equal((await read()).ownerId, maya.personId, "the restored agent keeps its new owner");
      },
    );
    assert.deepEqual(errors, []);
  } catch (error) {
    await page.screenshot({ path: path.join(shots, "failure.png") }).catch(() => undefined);
    fs.writeFileSync(
      path.join(shots, "failure.txt"),
      `${String(error)}\n${await page
        .locator("body")
        .innerText()
        .catch(() => "")}`,
    );
    throw error;
  } finally {
    await context.close();
    await browser.close();
    web.close();
    await space.stop();
    fs.rmSync(space.dir, { recursive: true, force: true });
  }
});
