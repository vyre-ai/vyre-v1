// THE CONNECT CARD FOR EVERY SERVICE A KEY IS PASTED FOR, in the real app (r32-connect, 16 Nov 2026): the production export in a real browser against a booted daemon whose agent is scripted and whose outside network is ONE stand-in that
// answers by host and repeats every credential in its error words (test/support/service-stand-in.ts; never a real service, no real key). One card for all services: for each, the agent asks by name, the card shows its fields (several for Zoom
// and Twilio), says where the key goes ("Your key is sent only to ..."), a wrong key is refused in words, a key without the permission is told apart, a service that cannot be reached offers Retry, a good key connects and the agent goes
// on by itself, Disconnect removes it and the next ask is a clean card. Mailgun asks the region first and sends to the one host of the chosen region. Pictures (VYRE_CONNECT_SHOTS) of each state. The shared helpers live in connect-walk-kit.ts.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { edge } from "../apps/app/tests/real-app-harness.test.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { boot, scriptedModel, stop } from "./support/eco-live.ts";
import { agentFor, apiOf, claim, needChrome, withFetchStub } from "./connect-walk-kit.ts";
import type { Skins } from "./connect-walk-kit.ts";
import { SVCS, serviceNetwork } from "./support/service-stand-in.ts";
import type { Seen } from "./support/service-stand-in.ts";

/** Which services a walk covers, by the title a person says. */
export async function servicesWalk(
  t: { skip(m: string): void },
  titles: readonly string[],
  SKINS: Skins,
  label: string,
  pictured: readonly string[] = titles,
): Promise<void> {
  const c = await needChrome(t);
  if (!c) return;
  const shots = process.env["VYRE_CONNECT_SHOTS"] ?? "/tmp/vyre-connect-shots";
  fs.mkdirSync(shots, { recursive: true });
  const undo = withFetchStub();
  const model = scriptedModel(async function* (input, run) {
    const ask = input.trigger?.body ?? "";
    const want = /please connect ([a-z ]+)/i.exec(ask)?.[1]?.trim();
    if (want) {
      const service = want.replace(/\b[a-z]/g, (x) => x.toUpperCase());
      const r = yield* run("vault_connect", { service, idempotencyKey: `sw-${Math.random()}` });
      yield { type: "text", text: r.ok ? `Not yet. Add the ${service} key and I'll connect it.` : "FAILED" };
    } else if (/Carry on|is connected\./.test(ask)) {
      const named = /^([A-Za-z ]+?) is connected/.exec(ask)?.[1] ?? "The service";
      yield { type: "text", text: `Yes, ${named} is connected.` };
    }
  });
  const seen: Seen[] = [];
  const basics = new Set<string>();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-connect-services-"));
  const d = await boot(dir, model, {
    vault: undefined,
    connectorNetwork: serviceNetwork(seen, basics),
    config: loadConfig(
      ["--data-dir", dir, "--port", "0", "--space", "spc_7d1e0c2b9a4f5e6d8c3b2a19", "--space-kind", "personal"],
      {},
      "1.2.3",
    ),
  });
  const web = await edge(c.dist, d.url);
  const browser = await c.chromium.launch({ executablePath: c.exe, args: ["--no-sandbox"] });
  const log: string[] = [];
  try {
    const { session, token } = await claim(browser, d, web.origin);
    const api = apiOf(d, token);
    const agentId = await agentFor(d, api, token);
    let n = 0;
    for (const [scheme, w, hgt] of SKINS) {
      const tag = `${scheme}-${w}`;
      const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, colorScheme: scheme });
      await ctx.addInitScript((v: string) => {
        try {
          if (!localStorage.getItem("vyre.session.v1")) localStorage.setItem("vyre.session.v1", v);
        } catch {
          /* blocked */
        }
      }, session);
      const page = await ctx.newPage();
      const errs: string[] = [];
      page.on("pageerror", (e) => errs.push(e.message));
      let opened = false;
      /** Ask in a fresh chat, and answer the card that comes. */
      const ask = async (title: string): Promise<string> => {
        const threadId = (
          await api("chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: `sw-chat-${++n}` })
        ).thread.threadId as string;
        const posted = await api("chat.post", {
          threadId,
          body: `please connect ${title.toLowerCase()}`,
          mentions: [{ kind: "agent", id: agentId }],
          idempotencyKey: `sw-post-${n}`,
        });
        await page.goto(`${web.origin}/open/message/${threadId}/${posted.message.messageId}`, { waitUntil: "load" });
        if (!opened) {
          await page
            .getByText("Continue", { exact: true })
            .click({ timeout: 3000 })
            .catch(() => undefined);
          await page
            .getByTestId("onboarding-close")
            .click({ timeout: 4000 })
            .catch(() => undefined);
          opened = true;
        }
        const card = page.locator("[data-testid^='connect-vrq_']").first();
        await card.waitFor({ timeout: 120_000 }).catch(async (e) => {
          await page.screenshot({ path: `${shots}/no-card-${title}-${tag}.png` });
          fs.writeFileSync(
            `${shots}/no-card-${title}-${tag}.txt`,
            `${(await page.locator("body").innerText()).slice(0, 2000)}\n${errs.join("\n")}`,
          );
          throw e;
        });
        return (await card.getAttribute("data-testid"))!.replace(/^(connect-vrq_[0-9a-f]+).*$/, "$1");
      };
      /** What a card showed when a wait on it failed, in the folder CI uploads: a screenshot and the card's elements, the request, the connections, the calls the stand-in app saw, the page errors and the page text. */
      const evidence = async (label: string, cardId: string, slug: string): Promise<void> => {
        const dir = `${process.env["VYRE_TEST_CAPTURE_DIR"] ?? shots}/connect-services`;
        fs.mkdirSync(dir, { recursive: true });
        const state = await api("vault.requests.get", { requestId: cardId.replace(/^connect-/, "") }).catch(
          (x: unknown) => ({
            error: String(x).slice(0, 300),
          }),
        );
        const conns = await api("connections.list", {}).catch((x: unknown) => ({ error: String(x).slice(0, 300) }));
        const elements = await page
          .locator(`[data-testid^='${cardId}']`)
          .evaluateAll((els) => els.map((x) => `${x.getAttribute("data-testid")}`))
          .catch(() => []);
        const cards = await page
          .locator("[data-testid^='connect-vrq_']")
          .evaluateAll((els) => els.map((x) => `${x.getAttribute("data-testid")}`))
          .catch(() => []);
        await page.screenshot({ path: `${dir}/${slug}-${tag}-${label}.png` }).catch(() => undefined);
        fs.writeFileSync(
          `${dir}/${slug}-${tag}-${label}.txt`,
          [
            `waited on card ${cardId}: its elements ${elements.join(" ")}`,
            `every connect card on the page: ${cards.join(" ")}`,
            `address ${page.url()}`,
            `request ${JSON.stringify(state).slice(0, 1500)}`,
            `connections ${JSON.stringify(conns).slice(0, 1500)}`,
            `calls the stand-in app saw since the last Connect: ${seen
              .map((r) => `${r.host} ${r.url}`)
              .join(" | ")
              .slice(0, 1500)}`,
            `page errors: ${errs.join(" | ").slice(0, 800)}`,
            `page text:\n${(
              await page
                .locator("body")
                .innerText()
                .catch(() => "")
            ).slice(0, 2500)}`,
          ].join("\n"),
        );
      };
      for (const title of titles) {
        const svc = SVCS.find((s) => s.title === title)!;
        const slug = title.toLowerCase().replace(/[^a-z]+/g, "");
        const id = await ask(title);
        const q = (s: string) => page.locator(`[data-testid='${id}${s}']`);
        const shot = async (name: string) => {
          if (pictured.includes(title)) await page.screenshot({ path: `${shots}/${slug}-${name}-${tag}.png` });
        };
        const fill = async (tagValue: string) => {
          for (const f of svc.fields) await q(`-${f}-input`).fill(`sentinel_${tagValue}_${slug}_${f}_0123456789`);
        };
        const sayHosts = async () => (await q("-checks").innerText()).replace(/\s+/g, " ");
        // the card for this service: every field a person pastes, and where the key goes, before anything is typed
        for (const f of svc.fields)
          await q(`-${f}-input`)
            .waitFor({ timeout: 20_000 })
            .catch(async (e) => {
              await evidence("no-input", id, slug);
              throw e;
            });
        assert.match(await sayHosts(), /sent only to/i, `${title}: the card says where the key goes`);
        if (title === "Mailgun") {
          assert.match(await sayHosts(), /api\.mailgun\.net/);
          assert.doesNotMatch(await sayHosts(), /eu\.mailgun/, "one region at a time, never both");
          await q("-choice-eu").click();
          assert.match(await sayHosts(), /api\.eu\.mailgun\.net/);
          assert.doesNotMatch(await sayHosts(), /api\.mailgun\.net/);
          await shot("region-eu");
          await q("-choice-us").click();
          assert.match(await sayHosts(), /api\.mailgun\.net/);
        }
        if (title === "Zoom")
          assert.match(await sayHosts(), /zoom\.us and api\.zoom\.us/, "Zoom: exactly its two hosts");
        await page.waitForTimeout(600);
        await shot("ask");
        // an empty Connect says what is missing
        await q("-connect").click();
        await page.waitForTimeout(500);
        assert.ok(
          /needed/i.test(await page.locator("body").innerText()),
          `${title}: an empty Connect says what is missing`,
        );
        // a wrong key stays on the card
        await fill("BADKEY");
        await q("-connect").click();
        await page.waitForSelector("text=/didn't accept/", { timeout: 20_000 });
        await shot("wrong");
        assert.ok(await q("-connect").count(), `${title}: the card stays after a wrong key`);
        // a key without the permission is told apart
        if (svc.limited) {
          await fill("LIMITED");
          await q("-connect").click();
          await page.waitForSelector("text=/can't read/", { timeout: 20_000 });
          await shot("noaccess");
        }
        // a service that is down, then one that cannot be reached
        await fill("DOWN");
        await q("-connect").click();
        await q("-retry").waitFor({ timeout: 20_000 });
        await shot("offline");
        // a good key connects; the agent goes on by itself
        await q("-later").click();
        await q("-reopen").waitFor({ timeout: 8000 });
        await q("-reopen").click();
        await q("-connect").waitFor({ timeout: 8000 });
        await fill("GOOD");
        seen.length = 0;
        await q("-connect").click();
        // when the connected row does not show, say what the card showed (see evidence)
        await q("-row")
          .waitFor({ timeout: 25_000 })
          .catch(async (e) => {
            await evidence("no-row", id, slug);
            throw e;
          });
        await shot("done");
        await page.getByText(new RegExp(`Yes, .*is connected\\.`)).first().waitFor({ timeout: 40_000 });
        const body = await page.locator("body").innerText();
        for (const f of svc.fields)
          assert.equal(body.includes(`sentinel_GOOD_${slug}_${f}_0123456789`), false, "no key on the page");
        // the key went to the one host of the service: never in an address, never anywhere else
        const good = seen.filter((r) => !/BADKEY|LIMITED|DOWN/.test(`${r.auth} ${r.body}`));
        const hosts = new Set(good.map((r) => r.host));
        assert.ok(
          [...hosts].every((h) => [svc.host, svc.run.host].includes(h)),
          `${title}: only its own hosts: ${[...hosts].join(", ")}`,
        );
        assert.ok(
          seen.every((r) => !/sentinel_/.test(r.url)),
          "no key in any address",
        );
        // Disconnect, and the next ask is a clean card (the card redraws when the agent's reply lands: open it again if it closed)
        for (let tries = 0; tries < 4; tries++) {
          await page.waitForTimeout(700);
          if ((await q("-disconnect").count()) === 0) await q("-row").click();
          const pressed = await q("-disconnect")
            .click({ timeout: 4000 })
            .then(
              () => true,
              () => false,
            );
          if (pressed) break;
        }
        await q("-reopen").waitFor({ timeout: 8000 });
        assert.equal(
          (await api("connections.list", {})).connections.filter(
            (x: { connector: string }) => x.connector.startsWith(slug.slice(0, 5)) && x.connector === svc.key,
          ).length,
          0,
          `${title}: no connection is left`,
        );
        const again = await ask(title);
        const q2 = (s: string) => page.locator(`[data-testid='${again}${s}']`);
        await q2(`-${svc.fields[0]}-input`)
          .waitFor({ timeout: 20_000 })
          .catch(async (e) => {
            await evidence("again-no-input", again, slug);
            throw e;
          });
        assert.equal(await q2(`-${svc.fields[0]}-input`).inputValue(), "", `${title}: asking again shows a clean card`);
        assert.equal(await q2("-have").count(), 0, "the key the first card saved is not offered back");
        // Mailgun's other region: the key goes to its one host, and to no other
        if (title === "Mailgun") {
          await q2("-choice-eu").click();
          assert.match((await q2("-checks").innerText()).replace(/\s+/g, " "), /api\.eu\.mailgun\.net/);
          for (const f of svc.fields) await q2(`-${f}-input`).fill(`sentinel_GOOD_mailgun_eu_${f}_0123456789`);
          seen.length = 0;
          await q2("-connect").click();
          await q2("-row").waitFor({ timeout: 25_000 });
          const hostsEu = new Set(
            seen.filter((r) => !/BADKEY|LIMITED|DOWN/.test(`${r.auth} ${r.body}`)).map((r) => r.host),
          );
          assert.deepEqual([...hostsEu], ["api.eu.mailgun.net"], "the EU key went to the EU host alone");
          await shot("eu-done");
          await q2("-row").click();
          await q2("-disconnect").click({ timeout: 10_000 });
          await q2("-reopen").waitFor({ timeout: 8000 });
        }
        log.push(`${tag}: ${title}: every state reached by real presses`);
      }
      assert.deepEqual(errs, [], "no page errors");
      await ctx.close();
    }
    fs.writeFileSync(`${shots}/services-walk-${label}.txt`, log.join("\n") + "\n");
  } finally {
    undo();
    await browser.close();
    await web.close?.();
    await stop(d);
  }
}
