// EVERY SERVICE THE CARD OFFERS FOR A PASTED KEY, on a booted daemon (r32-connect, 16 Nov 2026). The real connectors module, the real Vault, the real capability pipeline; the services are ONE stand-in network that answers by host the way the
// public documents say, and that repeats every credential it was sent (the header and the body, raw and as Basic) in its error words. For each of Stripe, Resend, HubSpot, Mailgun (US and EU), Dropbox Sign, Zoom and Twilio:
// the card is asked for by name; a wrong key, a key without the permission and a service that cannot be reached each stay on the card and keep nothing; a good key connects, keeps the key in the Vault and nothing else, and the
// connection runs an action as the agent would, the key going to the exact host only and never in an address. At the end NO file of the data folder (database, audit, trace, log, event) holds any typed value or its Basic form.
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { bootHour, say, messages, waitFor } from "./support/member-hour.ts";
import { SVCS, serviceNetwork } from "./support/service-stand-in.ts";
import type { Seen } from "./support/service-stand-in.ts";

process.env["VYRE_CONNECT_CARD"] = "1";

const typed: string[] = [];
/** every Basic credential the stand-in was sent (the encoded pair): it is searched for in the data folder too */
const basics = new Set<string>();
const seen: Seen[] = [];
const network = serviceNetwork(seen, basics);

test("every offered service: asked by name, wrong and limited and unreachable keep nothing, a good key connects and runs, and no typed value is in any file afterwards", async () => {
  const h = await bootHour("connectservices", { connectorNetwork: network });
  try {
    const own = h.owner;
    const items = async (): Promise<number> => ((await own.call("vault.items.list", {})).items as unknown[]).length;
    // one chat for each ask: a long chat is read a page at a time, and a person starts a new one for a new thing
    let threadId = "";
    const fresh = async (): Promise<void> => {
      threadId = (await own.call("chat.start", { kind: "chat", agentIds: [h.agentId] })).thread.threadId as string;
    };
    // the carry-on line after a connection wakes the agent for a turn of its own; the next ask waits until that turn has ended (the chat holds still), as a person's next message would
    const settle = async (): Promise<void> => {
      let last = -1;
      let still = 0;
      for (let i = 0; i < 80 && still < 6; i++) {
        const count = (await messages(h, own, threadId)).length;
        still = count === last ? still + 1 : 0;
        last = count;
        await new Promise((r) => setTimeout(r, 250));
      }
    };
    const asked = async (title: string, not?: string): Promise<string> => {
      if (threadId) await settle();
      await fresh();
      const said = await say(h, own, threadId, `please connect ${title.toLowerCase()}`).catch(async (e: unknown) => {
        const tail = (await messages(h, own, threadId))
          .slice(-8)
          .map((m) => `${m.author?.kind}:${String(m.body).slice(0, 90)}`);
        throw new Error(`${String(e)} || last: ${JSON.stringify(tail)}`);
      });
      assert.equal(said, "Not yet. Add its key.", said);
      const cards = (await messages(h, own, threadId))
        .flatMap((m) => m.blocks ?? [])
        .filter((x) => x.type === "vault_request");
      const last = cards.at(-1)!;
      assert.ok(last && last.data.requestId !== not, `${title}: a new card is in the chat`);
      return last.data.requestId as string;
    };
    for (const s of SVCS) {
      const requestId = await asked(s.title);
      let card = (await own.call("vault.connect_card.get", { requestId })).card;
      assert.equal(card.state, "ask", `${s.key}: the card asks`);
      assert.deepEqual(
        card.fields.filter((f: { optional: boolean }) => !f.optional).map((f: { name: string }) => f.name),
        s.fields,
      );
      if (s.title === "Mailgun") {
        assert.deepEqual(
          card.choice.options.map((o: { value: string }) => o.value),
          ["us", "eu"],
          "the person picks the region",
        );
        assert.deepEqual(card.checksWith, "api.mailgun.net", "the default region's host is said first");
      }
      const hosts =
        s.title === "Mailgun"
          ? card.choice.options.find((o: { value: string }) => o.value === s.choice).hosts
          : card.checksWith.split(", ");
      const submit = (tag: string) => {
        const fields = s.fields.map((f) => {
          const v = `sentinel_${tag}_${s.key}_${f}_0123456789`;
          typed.push(v);
          return { key: f, value: v };
        });
        return own.call("vault.connect_card.submit", {
          requestId,
          hosts,
          ...(s.choice ? { choice: s.choice } : {}),
          fields,
        });
      };
      const before = await items();
      // the key goes only where the card said, for the option picked: the other region's host, or both, is refused before anything is sent or kept
      if (s.choice) {
        const other = card.choice.options.find((o: { value: string }) => o.value !== s.choice).hosts as string[];
        seen.length = 0;
        for (const wrong of [other, [...hosts, ...other], []]) {
          const refused = await own.attempt("vault.connect_card.submit", {
            requestId,
            hosts: wrong,
            choice: s.choice,
            fields: s.fields.map((f) => ({ key: f, value: `sentinel_MISMATCH_${s.key}_${f}_0123456789` })),
          });
          assert.equal(refused.ok, false, `${s.key}: hosts that are not the picked region's are refused`);
        }
        assert.equal(seen.length, 0, `${s.key}: nothing was sent`);
        assert.equal(await items(), before);
      }
      // a wrong key
      let r = await submit("BADKEY");
      assert.equal(r.result, "wrong", `${s.key}: a wrong key`);
      assert.equal(r.card.state, "wrong");
      assert.equal(r.card.problem, undefined, "the key is wrong, not short of access");
      // a key without the permission is told apart
      if (s.limited) {
        r = await submit("LIMITED");
        assert.equal(r.result, "wrong", `${s.key}: a key without the permission`);
        assert.equal(r.card.state, "wrong");
        assert.equal(r.card.problem, "permission", `${s.key}: said as a permission problem, not a wrong key`);
      }
      // a service that is down and one that cannot be reached
      r = await submit("DOWN");
      assert.equal(r.result, "offline", `${s.key}: a 5xx is not a wrong key`);
      r = await submit("OFFLINE");
      assert.equal(r.result, "offline", `${s.key}: unreachable`);
      assert.equal(r.card.state, "offline");
      assert.equal(await items(), before, `${s.key}: nothing was kept by any of those`);
      assert.equal(
        ((await own.call("connections.list", { connector: s.key })).connections as unknown[]).length,
        0,
        `${s.key}: nothing was connected`,
      );
      // a good key
      const before_carried = 0;
      seen.length = 0;
      r = await submit("GOOD");
      assert.equal(r.result, "connected", `${s.key}: ${JSON.stringify(r)}`);
      assert.equal(r.card.state, "connected");
      assert.equal(await items(), before + 1, `${s.key}: one item in the Vault`);
      // the agent that asked goes on by itself: its own turn answers, after the connection (nothing is typed to it)
      const carried = async (): Promise<number> =>
        (await messages(h, own, threadId)).filter(
          (m) => m.author?.kind === "agent" && /^(USED|FAILED)/.test(m.body ?? ""),
        ).length;
      await waitFor(
        async () => ((await carried()) > before_carried ? true : null),
        40_000,
        `${s.key}: the agent goes on by itself`,
      );
      const good = seen.filter((q) => !/BADKEY|LIMITED|DOWN|OFFLINE/.test(q.auth + q.body));
      assert.ok(
        good.length >= 1 && good.every((q) => q.host === s.host),
        `${s.key}: the check went to ${s.host} only: ${JSON.stringify(seen.map((q) => q.host))}`,
      );
      assert.ok(
        seen.every((q) => !typed.some((v) => q.url.includes(v) || q.url.includes(encodeURIComponent(v)))),
        "no key in any address",
      );
      // the connection runs as the agent would run it (a Space service of the owner, used through the connection)
      seen.length = 0;
      const conn = (await own.call("connections.list", { connector: s.key })).connections[0].connectionId as string;
      const ran = await own.call("connectors.run", {
        key: s.key,
        action: s.run.action,
        connectionId: conn,
        input: s.run.input ?? {},
      });
      assert.ok(
        seen.length >= 1 && seen.every((q) => [s.run.host, s.host].includes(q.host)),
        `${s.key}: only its own hosts: ${JSON.stringify(seen.map((q) => q.host))}`,
      );
      assert.ok(!JSON.stringify(ran).includes("ZTOK_standin"), "a token never comes back");
      // Disconnect, and the next ask is a clean card
      await own.call("vault.connect_card.disconnect", { requestId });
      assert.equal(((await own.call("connections.list", { connector: s.key })).connections as unknown[]).length, 0);
      if (s.title !== "Mailgun" || s.choice === "eu") {
        const again = await asked(s.title, requestId);
        assert.equal((await own.call("vault.connect_card.get", { requestId: again })).card.state, "ask");
      }
    }
    // the typed values, and the Basic form of each pair, are in no file of the data folder
    await h.d.hooks?.pump?.();
    const needles = new Set<string>(typed);
    for (const v of typed) needles.add(Buffer.from(v).toString("base64"));
    for (const b of basics) needles.add(b);
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) walk(f);
        else if (e.isFile()) {
          const bytes = fs.readFileSync(f);
          for (const needle of needles) if (bytes.includes(needle)) found.push(`${f} holds ${needle.slice(0, 18)}`);
        }
      }
    };
    walk(h.dir);
    assert.deepEqual(found, [], "no audit row, trace, log, event or database file holds a typed key");
  } finally {
    await h.stop();
  }
});
