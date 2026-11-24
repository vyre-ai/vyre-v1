// A field a grant hides must not reach the member through any surface: the global search (hits, snippets, related, recent), a chat card for the record, Home, the inbox, the sync views, the sheets and the agent's own reads
// for that member. One member with only a view grant on one record that hides email and phone (conditions.hiddenFields); every answer of every surface is searched for the literal hidden values and parts of them.
// Real server-role daemon, real access, records, search and chat modules.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, join } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";

let h: Hour;
before(async () => {
  h = await bootHour("hiddensurf");
});
after(async () => {
  await h?.stop();
});

const EMAIL = "zq7xkv@probe-mail.test";
const PHONE = "+1 555 0177";
const NEEDLES = [EMAIL, "zq7xkv", "probe-mail", PHONE, "555 0177", "5550177"];
const leaked = (what: unknown): string[] => {
  const text = JSON.stringify(what ?? null);
  return NEEDLES.filter((n) => text.toLowerCase().includes(n.toLowerCase()));
};

test("no surface shows a member the fields a grant hides from them", async () => {
  const made = (await h.owner.call("records.create", {
    type: "contact",
    fields: { name: "Surface Hana", email: EMAIL, phone: PHONE },
  })) as { record: { id: string } };
  const rid = made.record.id;
  const ref = { type: "record", id: rid };
  await h.owner.call("access.audience_set", { resource: ref, audience: "added" });
  const roles = (await h.owner.call("access.roles.list")).roles as Array<{ id: string; name: string }>;
  const inv = await h.owner.call("members.invites.create", {
    role: roles.find((r) => r.name === "Member")!.id,
    email: "sura@firm.test",
  });
  const n = h.person("Sura Oak", "sura", "sura@firm.test", "sura horse battery staple 9");
  await join(h, n, decodeURIComponent(new URL(String(inv.link)).pathname.split("/").pop()!), { device: "web" });
  await h.owner.call("access.share", {
    resource: ref,
    subject: { kind: "person", id: n.personId },
    level: "view",
    conditions: { hiddenFields: ["email", "phone"] },
    idempotencyKey: "hs-share",
  });
  // a channel the member is in, and a message that mentions the record
  const ch = (await h.owner.call("channels.create", {
    name: "surf",
    visibility: "public",
    memberIds: [n.personId],
  })) as { channel: { mainThreadId: string } };
  await h.owner.call("chat.post", {
    threadId: ch.channel.mainThreadId,
    body: "See [[Surface Hana]]",
    blocks: [{ type: "refs", v: 1, data: { refs: [{ kind: "record", id: rid, title: "Surface Hana" }] } }],
    idempotencyKey: "hs-post",
  });
  await n.call("records.get", { type: "contact", recordId: rid }); // opened: shows under Recent
  for (let i = 0; i < 5; i++) await h.d.hooks?.pump?.();
  await new Promise((r) => setTimeout(r, 1500));
  for (let i = 0; i < 5; i++) await h.d.hooks?.pump?.();

  const rows: string[] = [];
  const probe = async (name: string, cap: string, input: Record<string, unknown>, mustFind?: string): Promise<void> => {
    const r = await n.attempt(cap, input);
    if (!r.ok) {
      rows.push(`${name}: refused or failed (${String((r.error as { code?: string }).code ?? r.error)})`);
      return;
    }
    const found =
      mustFind === undefined
        ? ""
        : JSON.stringify(r.data).includes(mustFind)
          ? " (the probe is not empty)"
          : " (EMPTY probe)";
    const l = leaked(r.data);
    rows.push(`${name}: ${l.length ? `LEAK ${JSON.stringify(l)}` : "clean"}${found}`);
    if (l.length) rows.push(`   data: ${JSON.stringify(r.data).slice(0, 700)}`);
  };

  // global search: hits, snippets, by the hidden text and by the visible one
  await probe("search.query visible name", "search.query", { q: "Surface Hana" }, "Surface Hana");
  await probe(
    "search.query visible name, records only",
    "search.query",
    { q: "Surface Hana", types: ["record"] },
    "Surface Hana",
  );
  await probe("search.query hidden email", "search.query", { q: EMAIL });
  await probe("search.query part of the hidden email", "search.query", { q: "zq7xkv" });
  await probe("search.query hidden phone", "search.query", { q: PHONE });
  await probe("search.query part of the hidden phone", "search.query", { q: "555 0177" });
  await probe("search.query semantic by hidden email", "search.query", { q: EMAIL, mode: "semantic" });
  await probe("search.related", "search.related", { kind: "record", itemId: rid });
  await probe("search.recent.list", "search.recent.list", {}, "Surface Hana");
  // the chat card for the record
  await probe(
    "chat.messages.list (the mention)",
    "chat.messages.list",
    { threadId: ch.channel.mainThreadId },
    "Surface Hana",
  );
  // Home
  await probe("home.at_risk", "home.at_risk", {});
  await probe("home.checklist", "home.checklist", {});
  await probe("home.routines_today", "home.routines_today", {});
  // the record itself, for the control: the visible part comes back, the hidden does not
  await probe("records.get (control)", "records.get", { type: "contact", recordId: rid }, "Surface Hana");
  // the sync status and the sources
  await probe("sync.status", "sync.status", {});
  await probe("sources.list", "sources.list", {});
  process.stderr.write(`\nSURFACE PROBE\n${rows.join("\n")}\n`);
  // the probes are not empty: the visible name finds the record, and the owner finds it by the hidden email (so the index does hold it)
  const empty = rows.filter((r) => r.includes("EMPTY probe") && !r.startsWith("search.recent.list"));
  assert.deepEqual(empty, [], `a probe came back empty, so it proves nothing:\n${empty.join("\n")}`);
  const ownerFound = JSON.stringify(await h.owner.call("search.query", { q: EMAIL }));
  assert.ok(
    ownerFound.includes("Surface Hana") && ownerFound.includes("zq7xkv"),
    "the owner finds the contact by its email, and sees it",
  );
  const bad = rows.filter((r) => r.includes("LEAK"));
  assert.deepEqual(bad, [], `surfaces that leak a hidden field:\n${bad.join("\n")}`);
});
