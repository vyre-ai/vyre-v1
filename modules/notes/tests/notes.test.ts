// Notes through the real handlers on a real SQLite database (lane L2): take, pin, label, share, delete with Undo; an image is a blob the blob route never serves; a link reads into a
// card; a private note exists for nobody else and for no agent outside its owner's own chats; a shared note follows its share; a task or record made from a note links both ways;
// a page clipped from Vyre for Chrome keeps its address, title, selection and screenshot.
// @reads /generated/registry.json
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ALIZA, ANDREY, failed, harness, ME, PNG } from "../fixtures/harness.ts";

const LUMA = "https://lu.ma/lab-8";
const ICON_SITE = "https://skool.com/mla-ai-labs";
const pages = {
  [LUMA]: JSON.stringify({ title: "Lab 8: Claude reads your intake calls", siteName: "Luma", image: "https://images.lu.ma/lab-8.png", description: "Thu 6 Nov, 6:00 PM ET", preview: { contentType: "image/png", data: PNG, from: "image" } }),
  [ICON_SITE]: JSON.stringify({ title: "MLA AI Labs", siteName: "Skool", icon: "https://skool.com/apple-touch-icon.png", preview: { contentType: "image/png", data: PNG, from: "icon" } }),
  "https://example.org/no-picture": JSON.stringify({ title: "No picture", image: "https://example.org/a.png" }),
  "https://example.org/svg": JSON.stringify({ title: "An SVG", preview: { contentType: "image/svg+xml", data: PNG, from: "image" } }),
};
const threads = {
  thr_mine: { starter: ME },                                   // my own chat with my Assistant
  thr_ask: { kind: "ask", starter: ME },                       // the Ask pane, opened by me
  thr_aliza: { starter: ALIZA },                               // Aliza's own chat
  thr_both: { starter: ME, members: [ALIZA] },                 // a chat with Aliza in it
  thr_labs: { channelId: "chn_labs" },                         // a public channel
  thr_pair: { channelId: "chn_pair" },                         // an invite-only channel of Irfad and Aliza
  thr_help: { parentThreadId: "thr_labs" },                    // a helper under the channel
};
const channels = { chn_labs: { visibility: "public" as const, members: [ME, ALIZA, ANDREY] }, chn_pair: { visibility: "invite" as const, members: [ME, ALIZA] } };
const world = () => harness({ threads, channels, pages });

test("take a note, pin it, label it, and find it by label and text; the list puts pinned notes first", async () => {
  const w = world();
  const a = (await w.call("notes.create", { title: "Weinberger intake call, 31 Oct", body: "Joe wants PI leads routed by county.\nSend the Lawmatics field list by Wed.", labels: ["Clients", "clients", " "] })).note;
  assert.deepEqual([a.title, a.labels, a.pinned, a.mine, a.canEdit, a.share], ["Weinberger intake call, 31 Oct", ["Clients"], false, true, true, { people: [], space: "off" }], "private, one label, case kept once");
  assert.deepEqual(w.events.map((e) => [e.name, e.opts]), [["notes.created", { vis: "owner" }]]);
  assert.deepEqual(Object.keys(w.events[0]!.payload).sort(), ["noteId", "owner"], "events carry ids only");
  w.advance(1000);
  const b = (await w.call("notes.create", { title: "GT+ pricing", body: "$1,500 a month" })).note;
  const pinned = (await w.call("notes.pin", { noteId: a.noteId, pinned: true })).note;
  assert.equal(pinned.pinned, true);
  const labelled = (await w.call("notes.label", { noteId: b.noteId, add: ["Sales", "Lab 8"], remove: ["Nope"] })).note;
  assert.deepEqual(labelled.labels, ["Sales", "Lab 8"]);
  assert.deepEqual((await w.call("notes.label", { noteId: b.noteId, remove: ["lab 8"] })).note.labels, ["Sales"]);
  const list = await w.call("notes.list", {});
  assert.deepEqual(list.notes.map((n: { noteId: string }) => n.noteId), [a.noteId, b.noteId], "pinned first");
  assert.deepEqual(list.labels, [{ name: "Clients", count: 1 }, { name: "Sales", count: 1 }]);
  assert.deepEqual((await w.call("notes.list", { label: "sales" })).notes.map((n: { noteId: string }) => n.noteId), [b.noteId]);
  assert.deepEqual((await w.call("notes.list", { q: "LAWMATICS" })).notes.map((n: { noteId: string }) => n.noteId), [a.noteId]);
  const hits = (await w.call("notes.search", { q: "field list" })).notes;
  assert.equal(hits.length, 1);
  assert.match(hits[0].snippet, /field list/);
  assert.equal(await failed(w.call("notes.create", { title: "  ", body: "" })), "validation.bad_input", "an empty note is not made");
});

test("the same idempotency key makes one note", async () => {
  const w = world();
  const a = await w.call("notes.create", { body: "once", idempotencyKey: "k1" });
  const b = await w.call("notes.create", { body: "once", idempotencyKey: "k1" });
  assert.equal(a.note.noteId, b.note.noteId);
  assert.equal((await w.call("notes.list", {})).total, 1);
});

test("delete takes the note out everywhere; Undo brings it back as it was", async () => {
  const w = world();
  const a = (await w.call("notes.create", { body: "Wifi at the office", labels: ["Ops"] })).note;
  const del = await w.call("notes.delete", { noteId: a.noteId });
  assert.deepEqual(del, { deleted: true, undo: { noteId: a.noteId } });
  assert.equal((await w.call("notes.list", {})).total, 0);
  assert.equal(await failed(w.call("notes.get", { noteId: a.noteId })), "validation.not_found");
  assert.equal((await w.call("notes.search", { q: "wifi" })).notes.length, 0);
  assert.equal(await failed(w.call("notes.restore", { noteId: a.noteId }, ALIZA)), "validation.not_found", "only the owner undoes it");
  const back = (await w.call("notes.restore", { noteId: a.noteId })).note;
  assert.deepEqual([back.body, back.labels], ["Wifi at the office", ["Ops"]]);
  assert.equal((await w.call("notes.list", {})).total, 1);
  assert.deepEqual(w.allEvents.map((e) => e.name), ["notes.created", "notes.deleted", "notes.restored"]);
});

test("pasting an image stores a blob the blob route never serves; the note hands it back to its readers only", async () => {
  const w = world();
  const a = (await w.call("notes.create", { title: "Lab 8 registrations, Mon", image: { data: PNG, contentType: "image/png" } })).note;
  assert.equal(a.hasImage, true);
  assert.equal(w.blobs.size, 1);
  const [blob] = [...w.blobs.values()];
  assert.equal(blob!.meta.contentType, "image/png");
  assert.equal(blob!.resource, undefined, "no access-layer resource: GET /blobs/<id> answers 403 for everyone");
  const img = await w.call("notes.image", { noteId: a.noteId });
  assert.deepEqual(img, { contentType: "image/png", data: PNG });
  assert.equal(await failed(w.call("notes.image", { noteId: a.noteId }, ALIZA)), "validation.not_found");
  const gone = (await w.call("notes.update", { noteId: a.noteId, image: null })).note;
  assert.equal(gone.hasImage, false);
  assert.equal(await failed(w.call("notes.create", { image: { data: "", contentType: "image/png" } })), "validation.bad_input");
});

test("a pasted link reads into a card with title, site name and a picture fetched on the server; one that cannot be read stays a plain link", async () => {
  const w = world();
  const a = (await w.call("notes.create", { link: LUMA, body: "Post with reel 1 on Tuesday" })).note;
  assert.deepEqual(a.link, { url: LUMA, siteName: "Luma", title: "Lab 8: Claude reads your intake calls", description: "Thu 6 Nov, 6:00 PM ET", preview: "image" });
  assert.deepEqual(w.calls.filter((c) => c.cap === "automations.read_link").map((c) => c.input), [{ url: LUMA, preview: true }], "the picture is fetched by the server");
  assert.doesNotMatch(JSON.stringify(a), /images\.lu\.ma/, "no other site's address reaches a browser");
  assert.equal((await w.call("notes.search", { q: "claude reads" })).notes[0].noteId, a.noteId, "the card's title is searchable");
  const b = (await w.call("notes.create", { link: "https://example.org/private" })).note;
  assert.deepEqual(b.link, { url: "https://example.org/private", siteName: "example.org" });
  assert.equal(await failed(w.call("notes.create", { link: "javascript:alert(1)" })), "validation.bad_input");
  assert.equal(w.calls.filter((c) => c.cap === "automations.read_link").length, 2, "a refused link is never fetched");
  const removed = (await w.call("notes.update", { noteId: a.noteId, link: null })).note;
  assert.equal(removed.link, undefined);
});

test("a link card's picture is a notes blob served by notes.image to readers only; else the site icon; else a plain card; never a type that is not a picture", async () => {
  const w = world();
  const a = (await w.call("notes.create", { link: LUMA })).note;
  const pic = [...w.blobs.values()].at(-1)!;
  assert.deepEqual([pic.meta.contentType, pic.resource], ["image/png", undefined], "a module blob with no resource: the blob route never serves it");
  assert.deepEqual(await w.call("notes.image", { noteId: a.noteId, part: "link" }), { contentType: "image/png", data: PNG });
  assert.equal(await failed(w.call("notes.image", { noteId: a.noteId, part: "link" }, ALIZA)), "validation.not_found");
  assert.equal(await failed(w.call("notes.image", { noteId: a.noteId })), "validation.not_found", "the note itself has no image");
  const icon = (await w.call("notes.create", { link: ICON_SITE })).note;
  assert.equal(icon.link.preview, "icon");
  assert.equal((await w.call("notes.image", { noteId: icon.noteId, part: "link" })).contentType, "image/png");
  for (const url of ["https://example.org/no-picture", "https://example.org/svg"]) {
    const plain = (await w.call("notes.create", { link: url })).note;
    assert.equal(plain.link.preview, undefined, url);
    assert.equal(await failed(w.call("notes.image", { noteId: plain.noteId, part: "link" })), "validation.not_found", url);
  }
  const moved = (await w.call("notes.update", { noteId: a.noteId, link: "https://example.org/no-picture" })).note;
  assert.equal(moved.link.preview, undefined);
  assert.equal(await failed(w.call("notes.image", { noteId: a.noteId, part: "link" })), "validation.not_found", "a new link without a picture drops the old one");
});

test("a private note exists for nobody else and for none of their agents", async () => {
  const w = world();
  const a = (await w.call("notes.create", { title: "Weinberger intake call", body: "He pays the DFY balance after the first live week." })).note;
  for (const who of [ALIZA, ANDREY]) {
    assert.equal(await failed(w.call("notes.get", { noteId: a.noteId }, who)), "validation.not_found", who);
    assert.equal((await w.call("notes.list", {}, who)).total, 0, who);
    assert.equal((await w.call("notes.search", { q: "dfy" }, who)).notes.length, 0, who);
    assert.equal(await failed(w.call("notes.update", { noteId: a.noteId, body: "x" }, who)), "validation.not_found", who);
    assert.equal(await failed(w.call("notes.pin", { noteId: a.noteId, pinned: true }, who)), "validation.not_found", who);
    assert.equal(await failed(w.call("notes.share", { noteId: a.noteId, space: "view" }, who)), "validation.not_found", who);
    assert.equal(await failed(w.call("notes.delete", { noteId: a.noteId }, who)), "validation.not_found", who);
    assert.equal(await failed(w.call("notes.to_task", { noteId: a.noteId }, who)), "validation.not_found", who);
  }
  const aliza = w.agent(ALIZA, "thr_aliza");
  assert.equal(await failed(w.call("notes.get", { noteId: a.noteId }, aliza)), "validation.not_found", "Aliza's agent in her own chat");
  assert.equal((await w.call("notes.search", { q: "dfy" }, aliza)).notes.length, 0);
  assert.equal(await failed(w.call("notes.get", { noteId: a.noteId }, w.agent(ALIZA, "thr_both"))), "validation.not_found", "even in a chat I am in, for Aliza's agent");
});

test("an agent reads your note in your own chat and Ask pane, never in a channel or a chat others read, unless the note is shared to them", async () => {
  const w = world();
  const a = (await w.call("notes.create", { title: "Weinberger intake call", body: "Send the Lawmatics field list by Wed." })).note;
  const mine = w.agent(ME, "thr_mine");
  assert.equal((await w.call("notes.get", { noteId: a.noteId }, mine)).note.body, "Send the Lawmatics field list by Wed.");
  assert.deepEqual((await w.call("notes.search", { q: "lawmatics" }, mine)).notes.map((n: { noteId: string }) => n.noteId), [a.noteId]);
  assert.equal((await w.call("notes.get", { noteId: a.noteId }, w.agent(ME, "thr_ask"))).note.noteId, a.noteId, "the Ask pane is my own");
  for (const t of ["thr_labs", "thr_pair", "thr_both", "thr_help"]) {
    assert.equal(await failed(w.call("notes.get", { noteId: a.noteId }, w.agent(ME, t))), "validation.not_found", t);
    assert.equal((await w.call("notes.search", { q: "lawmatics" }, w.agent(ME, t))).notes.length, 0, t);
    assert.equal(await failed(w.call("notes.pin", { noteId: a.noteId, pinned: true }, w.agent(ME, t))), "validation.not_found", `${t}: a write answers with the note, so it follows the same rule`);
  }
  assert.equal(await failed(w.call("notes.get", { noteId: a.noteId }, w.agent(ME))), "validation.not_found", "an agent in no chat (a run, an outside agent) reads only Space notes");
  // shared with Aliza: the chats she and I read, and the invite-only channel of us two
  await w.call("notes.share", { noteId: a.noteId, people: [{ personId: ALIZA, role: "view" }] });
  for (const t of ["thr_both", "thr_pair"]) assert.equal((await w.call("notes.get", { noteId: a.noteId }, w.agent(ME, t))).note.noteId, a.noteId, t);
  assert.equal(await failed(w.call("notes.get", { noteId: a.noteId }, w.agent(ME, "thr_labs"))), "validation.not_found", "still not the public channel");
  // shared with the Space: any chat or channel
  await w.call("notes.share", { noteId: a.noteId, space: "view" });
  for (const t of ["thr_labs", "thr_help"]) assert.equal((await w.call("notes.get", { noteId: a.noteId }, w.agent(ME, t))).note.noteId, a.noteId, t);
  assert.equal((await w.call("notes.get", { noteId: a.noteId }, w.agent(ANDREY, "thr_labs"))).note.noteId, a.noteId);
});

test("a shared note is read by the people it is shared with, edited by editors only, and shared by the owner only", async () => {
  const w = world();
  const a = (await w.call("notes.create", { title: "Lab 8 run of show", body: "6:05 Andrey welcome" })).note;
  const shared = (await w.call("notes.share", { noteId: a.noteId, people: [{ personId: ALIZA, role: "edit" }, { personId: ANDREY, role: "view" }] })).note;
  assert.deepEqual(shared.share, { people: [{ personId: ALIZA, role: "edit" }, { personId: ANDREY, role: "view" }], space: "off" });
  assert.deepEqual(w.events.map((e) => [e.name, e.payload["people"], e.payload["space"]]), [["notes.shared", [ALIZA, ANDREY], "off"]]);
  const seen = (await w.call("notes.get", { noteId: a.noteId }, ALIZA)).note;
  assert.deepEqual([seen.mine, seen.canEdit], [false, true]);
  assert.equal((await w.call("notes.list", { from: "shared" }, ALIZA)).total, 1);
  assert.equal((await w.call("notes.list", { from: "mine" }, ALIZA)).total, 0);
  assert.equal((await w.call("notes.update", { noteId: a.noteId, body: "6:05 Andrey welcome, two minutes" }, ALIZA)).note.body, "6:05 Andrey welcome, two minutes");
  assert.equal((await w.call("notes.get", { noteId: a.noteId }, ANDREY)).note.canEdit, false);
  assert.equal(await failed(w.call("notes.update", { noteId: a.noteId, body: "x" }, ANDREY)), "validation.not_found", "a viewer does not edit");
  assert.equal(await failed(w.call("notes.share", { noteId: a.noteId, space: "view" }, ALIZA)), "permission.no_grant", "an editor does not share");
  assert.equal((await w.call("notes.get", { noteId: a.noteId }, w.agent(ALIZA, "thr_aliza"))).note.noteId, a.noteId, "Aliza's agent in her own chat");
  // Andrey removes it from his notes; his Undo brings it back; my note is untouched
  await w.call("notes.delete", { noteId: a.noteId }, ANDREY);
  assert.equal(await failed(w.call("notes.get", { noteId: a.noteId }, ANDREY)), "validation.not_found");
  assert.equal((await w.call("notes.get", { noteId: a.noteId })).note.share.people.length, 1);
  await w.call("notes.restore", { noteId: a.noteId }, ANDREY);
  assert.equal((await w.call("notes.get", { noteId: a.noteId }, ANDREY)).note.noteId, a.noteId);
  // taken back
  await w.call("notes.share", { noteId: a.noteId, people: [{ personId: ALIZA, role: "remove" }] });
  assert.equal(await failed(w.call("notes.get", { noteId: a.noteId }, ALIZA)), "validation.not_found");
  // the Space: everyone reads; a Space editor edits
  await w.call("notes.share", { noteId: a.noteId, space: "edit" });
  assert.equal((await w.call("notes.update", { noteId: a.noteId, title: "Lab 8 run of show, final" }, ALIZA)).note.title, "Lab 8 run of show, final");
});

test("turn into task and turn into record make linked items that point back at the note", async () => {
  const w = world();
  const a = (await w.call("notes.create", { title: "Weinberger intake call, 31 Oct", body: "Send Joe the Lawmatics field list by Wed." })).note;
  const t = await w.call("notes.to_task", { noteId: a.noteId, title: "Send Joe the Lawmatics custom field list", due: 1_762_300_000_000, idempotencyKey: "tk1" });
  const sent = w.calls.find((c) => c.cap === "tasks.create")!.input;
  assert.deepEqual([sent["title"], sent["assigned"], sent["source"], sent["due"]], ["Send Joe the Lawmatics custom field list", { kind: "person", id: ME }, { kind: "manual", id: a.noteId }, 1_762_300_000_000]);
  assert.match(String(sent["summary"]), /Lawmatics field list by Wed\.[\s\S]*From the note "Weinberger intake call, 31 Oct"/);
  assert.deepEqual(t.note.linked.map((l: { kind: string; id: string }) => [l.kind, l.id]), [["task", t.taskId]]);
  const again = await w.call("notes.to_task", { noteId: a.noteId, idempotencyKey: "tk1" });
  assert.deepEqual([again.taskId, again.note.linked.length], [t.taskId, 1], "the same key: the tasks module answers with the same task, linked once");
  const r = await w.call("notes.to_record", { noteId: a.noteId, type: "client", fields: { name: "Weinberger Law", contact: "Joe Weinberger" }, keep: false });
  assert.deepEqual(w.calls.filter((c) => c.cap === "records.create").map((c) => [c.input["type"], c.input["fields"]]), [["client", { name: "Weinberger Law", contact: "Joe Weinberger" }]]);
  assert.deepEqual(r.note.linked.at(-1).title, "Weinberger Law");
  assert.ok(w.allEvents.filter((e) => e.name === "notes.linked").every((e) => typeof e.payload["id"] === "string"));
  assert.equal((await w.call("notes.list", {})).total, 0, "keep false: the note leaves the grid");
  assert.equal((await w.call("notes.get", { noteId: a.noteId })).note.noteId, a.noteId, "and still opens from the task or record");
});

test("a page clipped from Vyre for Chrome keeps its address, title, selection and screenshot, private", async () => {
  const w = world();
  const html = readFileSync(new URL("../fixtures/page.html", import.meta.url), "utf8");
  // what the extension sends: the tab's address and title, the selected text, a screenshot
  const title = /<title>([^<]*)<\/title>/.exec(html)![1]!.replace(/&amp;/g, "&");
  const selection = /<p id="selected">([^<]*)<\/p>/.exec(html)![1]!;
  const out = (await w.call("notes.clip", { url: "https://baileyandgalyen.com/free-consultation", title, selection, screenshot: { data: PNG, contentType: "image/png" }, labels: ["Reading"] })).note;
  assert.deepEqual([out.title, out.clip.url, out.clip.selection, out.clip.hasShot, out.hasImage, out.labels, out.share], [
    "Free consultation | Bailey & Galyen", "https://baileyandgalyen.com/free-consultation", "Call us 24/7. Se habla español. No fee unless we win.", true, true, ["Reading"], { people: [], space: "off" },
  ]);
  assert.deepEqual(w.events.map((e) => e.name), ["notes.clipped"]);
  assert.equal((await w.call("notes.search", { q: "se habla" })).notes[0].noteId, out.noteId);
  assert.equal(await failed(w.call("notes.get", { noteId: out.noteId }, ALIZA)), "validation.not_found");
  assert.equal(await failed(w.call("notes.clip", { url: "https://example.org" }, w.agent(ME, "thr_mine"))), "permission.no_grant", "only a person clips");
  assert.equal(await failed(w.call("notes.clip", { url: "file:///etc/passwd" })), "validation.bad_input");
});

test("an address in a note's words gets its link card, on create and when it is typed or pasted into the opened note; a note that has a card is not read again", async () => {
  const w = world();
  const made = (await w.call("notes.create", { title: "Testing", body: `Testing ${LUMA}.` })).note;
  assert.equal(made.link?.url, LUMA, "the address in the words became the card");
  assert.equal(made.link?.title, "Lab 8: Claude reads your intake calls");
  assert.equal(made.body, `Testing ${LUMA}.`, "the words stay as written");
  const plain = (await w.call("notes.create", { title: "Plain", body: "Testing" })).note;
  assert.equal(plain.link, undefined);
  const typed = (await w.call("notes.update", { noteId: plain.noteId, body: `Testing ${ICON_SITE}` })).note;
  assert.equal(typed.link?.url, ICON_SITE, "an address that is new in the words gets its card");
  assert.equal(typed.link?.preview, "icon");
  // a card already there stays: another address typed later does not replace it
  const again = (await w.call("notes.update", { noteId: plain.noteId, body: `Testing ${ICON_SITE} and ${LUMA}` })).note;
  assert.equal(again.link?.url, ICON_SITE);
  // removing the card is honoured while the address stays in the words
  const removed = (await w.call("notes.update", { noteId: plain.noteId, link: null })).note;
  assert.equal(removed.link, undefined);
  const edited = (await w.call("notes.update", { noteId: plain.noteId, body: `Testing ${ICON_SITE} again` })).note;
  assert.equal(edited.link, undefined, "the same address, already in the words, is not read again after the person removed its card");
});

// ---- saved from a chat (agents make notes natively; the person's own private note links back to the message)
const chats = {
  thr_dm: { starter: ME, title: "Weinberger Law prep" },                                  // my own chat with my Assistant
  thr_team: { channelId: "chn_team", title: "intake" },                                    // a channel Aliza and I are in
  thr_other: { starter: ALIZA, title: "Aliza's own chat" },                                // a chat I cannot read
};
const sourceWorld = () => harness({
  threads: chats, channels: { chn_team: { visibility: "invite" as const, members: [ME, ALIZA] } },
  messages: { thr_dm: [{ messageId: "msg_1", createdAt: NOW_MSG }], thr_team: [{ messageId: "msg_9", createdAt: NOW_MSG }], thr_other: [{ messageId: "msg_5" }] },
});
const NOW_MSG = 1_762_150_000_000;

test("a note saved from a chat is the person's own and private, and links back to that exact message with the chat's title and the message's time", async () => {
  const w = sourceWorld();
  const n = (await w.call("notes.create", { title: "Weinberger form link", body: "weinbergerlaw.com/intake-form", source: { threadId: "thr_dm", messageId: "msg_1" } })).note;
  assert.deepEqual(n.from, { threadId: "thr_dm", messageId: "msg_1", title: "Weinberger Law prep", at: NOW_MSG, readable: true });
  assert.deepEqual([n.mine, n.share], [true, { people: [], space: "off" }], "private to the person");
  const got = (await w.call("notes.get", { noteId: n.noteId })).note;
  assert.equal(got.from?.readable, true);
});

test("a note saved from a shared channel is still only the person's: Aliza, who is in the channel, does not read it, and the link is not handed to anyone a note is shared with", async () => {
  const w = sourceWorld();
  const n = (await w.call("notes.create", { title: "Decision", body: "Go with Tuesday", source: { threadId: "thr_team", messageId: "msg_9" } })).note;
  assert.equal(await failed(w.call("notes.get", { noteId: n.noteId }, ALIZA)), "validation.not_found", "a channel member does not read the person's private note");
  await w.call("notes.share", { noteId: n.noteId, people: [{ personId: ALIZA, role: "view" }] });
  const theirs = (await w.call("notes.get", { noteId: n.noteId }, ALIZA)).note;
  assert.equal(theirs.from, undefined, "a note shared with someone carries no link into the owner's chat");
});

test("the link is refused to someone who cannot read the chat: no chat, no message, no title, and a note cannot be saved from a chat the person cannot read", async () => {
  const w = sourceWorld();
  assert.equal(await failed(w.call("notes.create", { title: "x", body: "y", source: { threadId: "thr_other", messageId: "msg_5" } })), "validation.not_found", "a chat the person cannot read");
  assert.equal(await failed(w.call("notes.create", { title: "x", body: "y", source: { threadId: "thr_dm", messageId: "msg_404" } })), "validation.not_found", "a message that is not in that chat");
  // the owner loses the chat (removed from the channel): the note keeps only when it was saved
  const own = { ...chats, thr_gone: { channelId: "chn_gone", title: "ops" } };
  const channels = { chn_team: { visibility: "invite" as const, members: [ME, ALIZA] }, chn_gone: { visibility: "invite" as const, members: [ME] } };
  const w2 = harness({ threads: own, channels, messages: { thr_gone: [{ messageId: "msg_7", createdAt: NOW_MSG }] } });
  const made = (await w2.call("notes.create", { title: "Ops", body: "Rotate the key", source: { threadId: "thr_gone", messageId: "msg_7" } })).note;
  channels.chn_gone.members = [ALIZA];
  const later = (await w2.call("notes.get", { noteId: made.noteId })).note;
  assert.deepEqual(later.from, { at: NOW_MSG, readable: false });
  const list = (await w2.call("notes.list", {})).notes;
  assert.deepEqual(list[0].from, { at: NOW_MSG, readable: false });
});

test("an agent saving a note from the chat it is in: the note is the person's, private, and links to the chat's latest message; it may not name another chat", async () => {
  const w = sourceWorld();
  const bot = w.agent(ME, "thr_dm");
  const n = (await w.call("notes.create", { title: "Save this", body: "The answer to keep" }, bot)).note;
  assert.equal(n.from?.messageId, "msg_1");
  assert.equal(n.owner, ME);
  assert.equal(await failed(w.call("notes.create", { title: "x", body: "y", source: { threadId: "thr_team", messageId: "msg_9" } }, bot)), "validation.not_found");
});
