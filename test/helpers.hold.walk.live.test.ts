// A helper's approval in the chat the person asked in (release gate blocker, 12 Nov): a helper opens a link it put together itself, the Gate holds it, and the lead chat shows the helper's row
// as "Needs you" with what it waits for and the approval card (Allow, Always allow, Deny); Allow lets it finish. The real app against a booted daemon; the model is scripted.
// Needs the web export (VYRE_APP_DIST) and a browser. Screenshots: helper-hold-card.png, helper-hold-allowed.png.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeBundle } from "../client/src/crypto/keys.ts";
import { holdKeyOnOwnNode } from "../client/src/gateway/local-key.ts";
import { edge } from "../apps/app/tests/real-app-harness.test.ts";
import { guardCrashes } from "../apps/app/tests/crash-guard.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { boot, hostLog, scriptedModel, stop, waitFor, KEY } from "./support/eco-live.ts";

const PASSWORD = "helper hold password 7731";

test(
  "a helper's held link: the lead chat shows its row as Needs you and the approval card; Allow lets it finish",
  { timeout: 180_000 },
  async (t) => {
    const dist = process.env["VYRE_APP_DIST"];
    if (!dist) {
      if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required");
      t.skip("VYRE_APP_DIST required for browser evidence");
      return;
    }
    const pw = await import("playwright-core");
    const exe = process.env["CHROME_BIN"] || pw.chromium.executablePath();
    assert.ok(fs.existsSync(exe), `a browser is required at ${exe}`);
    const shots = process.env["VYRE_TEST_CAPTURE_DIR"] ?? fs.mkdtempSync(path.join(os.tmpdir(), "vyre-helper-hold-"));
    fs.mkdirSync(shots, { recursive: true });
    let agent = "";
    let chat = "";
    let go = false;
    const model = scriptedModel(async function* (input, run) {
      if (input.agent.id !== agent) return;
      if (input.threadId === chat) {
        if (/rates/.test(input.trigger?.body ?? "")) {
          yield* run("tool_search", { query: "sub task helper" });
          yield* run("sub_task_model", {
            threadId: input.threadId,
            title: "Rates on the web",
            instruction: "Look up the current Harbor rates on the web.",
            idempotencyKey: "hw-1",
          });
          yield { type: "text", text: "I'll give you the answer as soon as the helper reports." };
        }
        return;
      }
      if (input.resumed) {
        yield {
          type: "text",
          text: input.resumed.approved ? "The rates page is open." : "I could not open the rates page.",
        };
        return;
      }
      if (!/Look up the current Harbor rates/.test(input.trigger?.body ?? "")) {
        yield { type: "text", text: "Reported above." };
        return;
      }
      yield* run("tool_search", { query: "notes create" });
      yield* run("tool_search", { query: "read link" });
      // a link it puts together is a read in an ordinary chat (lead's ruling, 12 Nov): it goes through; the note it writes in Ask first is the change that waits for the person
      yield* run("read_link", { url: "https://www.other-rates.example/compare" });
      while (!go) await new Promise((r) => setTimeout(r, 100)); // the test puts the helper\'s own chat in Ask first first
      yield* run("notes_create", {
        title: "Harbor rates",
        body: "From harborquotes.example",
        idempotencyKey: "hx-note",
      });
      yield { type: "text", text: "Done." };
    });
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-helper-hold-")));
    const d = await boot(dir, model, {
      config: loadConfig(
        ["--data-dir", dir, "--port", "0", "--space", "spc_fresh", "--space-name", "Card Co"],
        {},
        "1.2.3",
      ),
    });
    const web = await edge(dist, d.url);
    const browser = await pw.chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
    try {
      const code = /claim\/([^#]+)/.exec(d.claim!.url)![1]!;
      const spaceId = /s=([^&]+)/.exec(d.claim!.url)![1]!;
      const made = await makeBundle(PASSWORD, "helper-hold-recovery-code-1", { spaceId });
      const claimed = await fetch(`${d.url}/v1/identity/claim_owner`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code,
          spaceId,
          displayName: "Maya Chen",
          username: "maya",
          password: PASSWORD,
          deviceName: "card",
          deviceClass: "desktop",
          keys: {
            personKeyByPassword: made.personKeyByPassword,
            personKeyByRecovery: made.personKeyByRecovery,
            publicKey: made.publicKey,
            privateKeyWrapped: made.privateKeyWrapped,
            spaceKeys: made.spaceKeys ?? [],
          },
        }),
      });
      assert.equal(claimed.status, 200, await claimed.clone().text());
      const token = ((await claimed.json()) as { data: { session: { token: string } } }).data.session.token;
      assert.equal(await holdKeyOnOwnNode(d.url, token, made.personKey), true);
      const api = async (cap: string, input: unknown): Promise<any> => {
        // eslint-disable-line @typescript-eslint/no-explicit-any
        const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify(input),
        });
        const body = (await r.json()) as { data?: unknown };
        assert.equal(r.status, 200, `${cap}: ${r.status} ${JSON.stringify(body)}`);
        return body.data;
      };
      const folder = (
        await api("vault.folders.create", { idempotencyKey: "b-folder", name: "Accounts", scope: "mine" })
      ).folder.id as string;
      const flow = await api("providers.subscription_start", { idempotencyKey: "b-flow", providerKey: "claude-code" });
      await api("vault.item.put", {
        idempotencyKey: "b-item",
        folderId: folder,
        name: "Maya_Claude",
        kind: "ai_subscription",
        fields: [{ key: "setup_token", value: KEY, secret: true }],
      });
      const provider = (await api("providers.subscription_complete", { flowId: flow.flowId })).provider.id as string;
      await api("providers.set_space_use", { idempotencyKey: "b-spaceuse", providerId: provider, allow: true });
      agent = (
        await api("agents.create", {
          name: "Scout",
          role: "You look things up for the team.",
          idempotencyKey: "h-agent",
        })
      ).agent.agentId as string;
      chat = (
        await api("chat.start", { kind: "chat", agentIds: [agent], title: "Rates check", idempotencyKey: "h-chat" })
      ).thread.threadId as string;
      await api("threads.set_mode", { threadId: chat, mode: "auto", idempotencyKey: "h-auto" });
      for (const flow of ["team", "personal", "member"])
        await api("spaces.onboarding.seen", { flow }).catch(() => undefined);
      await api("chat.post", {
        threadId: chat,
        body: "Look up the rates with a helper",
        mentions: [{ kind: "agent", id: agent }],
        idempotencyKey: "h-ask",
      });
      // the change the helper makes waits in Ask first: its own chat is put in Ask first (the lead chat stays in Auto, so starting the helper is not held)
      const helperThread = await waitFor(
        async () =>
          ((await api("engine.helpers.status", { threadId: chat })).helpers as Array<{ threadId: string }>)[0]
            ?.threadId ?? null,
        40_000,
        () => "no helper",
      );
      // the helper's chat may not be readable for an instant after it is listed: try again until it is
      await waitFor(
        async () => {
          try {
            await api("threads.set_mode", { threadId: helperThread, mode: "ask", idempotencyKey: "helper-ask" });
            return true;
          } catch {
            return null;
          }
        },
        20_000,
        () => "the helper's chat could not be put in Ask first",
      );
      go = true;
      const held = await waitFor(
        async () =>
          (
            (await api("engine.helpers.status", { threadId: chat })).helpers as Array<{
              state: string;
              holdTaskId?: string;
            }>
          ).find((h) => h.state === "needs_you" && h.holdTaskId) ?? null,
        60_000,
        () => hostLog(d),
      );
      const me = (await api("identity.whoami", {})).principal.id as string;
      const marker = (await api("spaces.get", {})).space.fingerprint as string;
      const session = {
        baseUrl: web.origin,
        token,
        personId: me,
        marker,
        def: {
          spaceId,
          name: "Card Co",
          kind: "team",
          address: web.origin,
          role: "Owner",
          tint: ["#6E5CF0", "#9B6BE8"],
          kit: "northwind",
          skinDefault: "system",
          starred: true,
          needsYou: false,
          console: true,
          terminal: false,
          counts: {},
          dots: {},
        },
      };
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await ctx.addInitScript((x: unknown) => {
        try {
          localStorage.setItem(
            "vyre.session.v1",
            JSON.stringify({ sessions: { [(x as { baseUrl: string }).baseUrl]: x } }),
          );
        } catch {
          /* blocked */
        }
      }, session);
      const page = await ctx.newPage();
      const guard = guardCrashes(page);
      const shot = async (name: string): Promise<void> => {
        await guard.check(name);
        await page.screenshot({ path: path.join(shots, `${name}.png`) });
      };
      await page.goto(`${web.origin}/chats#subject=thread:${chat}`, { waitUntil: "load" });
      const later = page.getByText("Finish later", { exact: true });
      if (await later.count())
        await later
          .first()
          .click()
          .catch(() => undefined);
      // the lead chat: the approval card of the helper's held call, and its row says what it waits for
      const card = page.getByTestId(`approval-${held.holdTaskId}`).first();
      // the row says it waits before the card is checked, so a missing card is pictured too
      await page.waitForTimeout(3000);
      await card.waitFor({ timeout: 40_000 }).catch(async (e) => {
        await page.screenshot({ path: path.join(shots, "helper-hold-FAILED-no-card.png") });
        throw e;
      });
      assert.match(await card.innerText(), /Rates on the web \(Scout\)/);
      assert.doesNotMatch(await card.innerText(), /automations|read link|read_link/);
      assert.ok(
        (await page.getByText("Needs your OK to", { exact: false }).count()) > 0,
        "the helper's row says what it waits for",
      );
      assert.equal(
        await page.getByText("Open the thread", { exact: true }).count(),
        0,
        "the raised card links to no thread",
      );
      await shot("helper-hold-card");
      await card.getByText("Allow", { exact: true }).first().click();
      await waitFor(
        async () =>
          ((await api("engine.helpers.status", { threadId: chat })).helpers as Array<{ state: string }>).every(
            (h) => h.state === "done",
          )
            ? true
            : null,
        60_000,
        () => hostLog(d),
      );
      await page.getByTestId(`approval-done-${held.holdTaskId}`).first().waitFor({ timeout: 20_000 });
      await shot("helper-hold-allowed");
      await ctx.close();
    } finally {
      await browser.close();
      web.close();
      await stop(d);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
