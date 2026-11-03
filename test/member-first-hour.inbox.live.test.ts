// Release gate: a newly invited member's first hour on a Vyre Server Space, part 3 of 3 (Inbox). The owner connects the firm's Google Workspace the way Console does it (the delegation key into a
// Restricted Vault folder, google.dwd.setup, company.connect), then two people invited by email join and sign in again (test/support/member-hour.ts twoMembers). Each opens Inbox: their own mail
// is there after the first pull, their calendar pulls, and a Google Doc in their Drive opens with its words, not "This file is empty". Nobody reads anyone else's. Every Space label is the name,
// and nothing their screens asked was refused unless meant. The owner's team met on 3 Nov: calendars never synced, Google Docs opened empty, channels loaded for ever.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { storeInVault } from "../apps/app/src/console/pages/suite/flow.ts";
import type { Run } from "../apps/app/src/console/pages/suite/flow.ts";
import { DOMAIN, SA_KEY_JSON, bootHour, screen, spaceLabels, twoMembers, unexpectedRefusals, waitFor } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";

const DAY = 86_400_000;
const NOW = Date.now();
const NATIVE = "application/vnd.google-apps.";
let h: Hour;
let a: Person;
let b: Person;
const people = (): Person[] => [a, b];

before(async () => {
  h = await bootHour("inbox");
  // what each of them has at Google before they arrive
  for (const who of ["aina", "bilal"]) {
    const email = `${who}@${DOMAIN}`;
    h.g.mail[email] = [{ id: `m-${who}`, subject: `Intake for ${who}`, from: "Pat Lee <pat@client.test>", at: NOW - 2 * DAY }];
    h.g.events[email] = [{ id: `ev-${who}`, status: "confirmed", summary: `Consult with ${who}`, start: { dateTime: new Date(NOW + DAY).toISOString() }, end: { dateTime: new Date(NOW + DAY + 3_600_000).toISOString() } }];
    h.g.files[email] = [{ id: `doc-${who}`, name: `${who} intake notes`, mimeType: `${NATIVE}document`, modifiedTime: "2026-11-02T10:00:00Z", parents: [`root-${who}`], markdown: `# Intake notes\n\nClient called about the ${who} matter.` }];
  }
  // the owner connects Google in Console: the key goes into the Restricted Connections folder, Google is checked as an admin, then Connect
  const run = (async (cap: string, input: unknown) => {
    const i = input as Record<string, unknown>;
    return h.owner.call(cap, i["idempotencyKey"] === "" ? { ...i, idempotencyKey: `console-${cap}-${Math.random().toString(36).slice(2)}` } : i);
  }) as Run;
  await run("company.start", { provider: "google" }, "Started.");
  const folders = (await h.owner.call("vault.folders.list", { scope: "shared" })).folders;
  assert.ok(await storeInVault(run, { name: "Google_DWD", handle: "#Google_DWD", text: SA_KEY_JSON, folders }), "the delegation key is in the Vault");
  assert.equal((await run<{ ok: boolean; problem?: string }>("company.check", {}, "Checked."))?.ok, true, "the key works");
  await run("google.dwd.setup", { vaultItem: "#Google_DWD", adminEmail: `irfad@${DOMAIN}`, hold: true, idempotencyKey: "" }, "Google accepted it.");
  ({ a, b } = await twoMembers(h));
  await run("company.connect", { idempotencyKey: "" }, "Connected.");
});
after(async () => { await h?.stop(); });

test("6 each opens Inbox: their own mail is there after the first pull, their calendar pulls, and a Google Doc in their Drive opens with its words", async () => {
  // the server's own jobs, as the minute timer runs them: the first pull of each new mailbox, and Calendar's pull of connected calendars
  await h.d.hooks!.runPeriodic("google.adopt_polls");
  for (const p of people()) {
    const side = await screen(p, "inbox.sidebar", "mailboxes", {});
    const box = (side.mailboxes as Array<{ id: string; address: string }>).find((m) => m.address === p.email);
    assert.ok(box, `${p.label} has their Google mailbox in Inbox: ${JSON.stringify(side.mailboxes)}`);
    assert.ok(!(side.mailboxes as Array<{ address: string }>).some((m) => m.address !== p.email), `${p.label} sees no one else's mailbox`);
    const subjects = await waitFor(async () => {
      const t = await screen(p, "inbox.contact-list", "threads", { mailboxId: box.id });
      const s = (t.threads as Array<{ subject?: string }>).map((x) => x.subject);
      return s.length > 0 ? s : null;
    }, 20_000, `${p.label}'s first pull`);
    assert.deepEqual(subjects, [`Intake for ${p.username}`], `${p.label}'s own mail, and only theirs`);
    await screen(p, "inbox.sidebar", "counts", {});
  }

  await h.d.hooks!.runPeriodic("calendar.pull_provider");
  for (const p of people()) {
    const cals = (await screen(p, "calendar.view", "calendars", {})).calendars as Array<{ id: string; provider: string; connectionId?: string }>;
    const gcal = cals.find((c) => c.provider === "google");
    assert.ok(gcal, `${p.label}'s Google calendar is in Calendar: ${JSON.stringify(cals)}`);
    const events = (await screen(p, "calendar.view", "events", { from: NOW - DAY, to: NOW + 2 * DAY, calendarIds: [gcal.id] })).events as Array<{ title: string }>;
    assert.deepEqual(events.map((e) => e.title), [`Consult with ${p.username}`], `${p.label}'s calendar pulled`);
    assert.deepEqual(h.d.sink.db.prepare("SELECT msg FROM logs WHERE msg LIKE '%calendar sync failed%'").all(), [], "no calendar sync failed");

    // Files: they mount their Drive and open the Doc in the one viewer
    const tree = await screen(p, "files.tree", "tree", {});
    const into = (tree.roots as Array<{ key: string; folderId?: string }>).find((r) => r.key === "personal")?.folderId ?? (tree.roots as Array<{ folderId?: string }>).find((r) => r.folderId)?.folderId;
    assert.ok(into, `${p.label} has a Files folder to mount into`);
    const added = await p.call("mounts.add", { into, source: { kind: "google_drive", connectionId: gcal.connectionId, ref: `root-${p.username}` }, name: "My Drive" });
    const listed = (await screen(p, "files.list", "items", { folder: added.folderId })).files as Array<{ fileId?: string; id?: string; name: string }>;
    const doc = listed.find((f) => f.name === `${p.username} intake notes`);
    assert.ok(doc, `${p.label}'s Doc is in the mount: ${JSON.stringify(listed)}`);
    const v = await screen(p, "files.viewer", "viewer", { fileId: doc.fileId ?? doc.id });
    assert.match(String(v.text ?? ""), new RegExp(`Client called about the ${p.username} matter`), `${p.label}'s Doc opens with its words, not empty: ${JSON.stringify(v).slice(0, 400)}`);
  }
});

test("9 every Space label the app shows them is the name, never an spc_ id", async () => {
  for (const p of people()) await spaceLabels(p);
});

test("10 no call their screens made was refused unless it was meant and said in plain words", () => {
  assert.deepEqual(unexpectedRefusals(h, people()), []);
});
