// Notes, the grid's rules: Pinned above Others, the label filter (an "or" over labels, Shared with me, From Chrome, With images), the search, the counts, and the words about who sees a note.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CHROME, IMAGES, SHARED, agentWords, askWords, dueChoices, editedWords, fillFromNote, filterLabel, labelCounts, matchesQuery, noteName, openable, patchNote, recordFields, shareWords,
  splitPinned, toggle, upsert, visibleNotes, whenWords,
} from "./model.ts";
import type { Note, RecordType, Who } from "./model.ts";

const T0 = Date.UTC(2026, 10, 3, 4, 0);
const note = (id: string, o: Partial<Note> = {}): Note => ({
  noteId: id, owner: "usr_me", title: "", body: "", color: "", pinned: false, labels: [], hasImage: false, linked: [], share: { people: [], space: "off" },
  mine: true, canEdit: true, createdAt: T0, updatedAt: T0, ...o,
});
const NOTES: Note[] = [
  note("n1", { title: "Lab 8 run of show", body: "6:00 doors open", labels: ["Lab 8"], pinned: true, color: "lilac", share: { people: [{ personId: "usr_aliza", role: "edit" }], space: "off" } }),
  note("n2", { title: "Weinberger intake call", body: "Joe wants PI leads routed by county", labels: ["Clients"], pinned: true }),
  note("n3", { title: "Lab 8 registrations", body: "212 on Luma", labels: ["Lab 8"], hasImage: true }),
  note("n5", { title: "Bailey & Galyen consult page", labels: ["Clients", "Reading"], hasImage: true, clip: { url: "https://baileyandgalyen.com/free-consultation", selection: "Se habla espanol.", hasShot: true, at: T0 } }),
  note("n6", { title: "Reel ideas", labels: ["Lab 8"], owner: "usr_aliza", mine: false, share: { people: [{ personId: "usr_me", role: "edit" }], space: "off" } }),
  note("n4", { link: { url: "https://docs.lawmatics.com/custom-fields", title: "Custom fields: create, map to forms", siteName: "Lawmatics Help Center" }, body: "For the Weinberger field list", labels: ["Clients"] }),
  note("n7", { title: "GT+ pricing", labels: ["Sales"], share: { people: [], space: "view" } }),
];
const ids = (ns: readonly Note[]): string[] => ns.map((n) => n.noteId);
const who: Who = { meId: "usr_me", nameOf: (id) => ({ usr_me: "Irfad Imtiaz", usr_aliza: "Aliza", usr_andrey: "Andrey" } as Record<string, string>)[id] ?? id, spaceName: "My Legal Academy" };

test("pinned notes sit above the rest, each group in the order it came", () => {
  const { pinned, others } = splitPinned(NOTES);
  assert.deepEqual(ids(pinned), ["n1", "n2"]);
  assert.deepEqual(ids(others), ["n3", "n5", "n6", "n4", "n7"]);
});

test("the filter is an or over its rows: labels, Shared with me, From Chrome, With images; nothing ticked shows all", () => {
  assert.deepEqual(ids(visibleNotes(NOTES, [], "")), ids(NOTES));
  assert.deepEqual(ids(visibleNotes(NOTES, ["Lab 8"], "")), ["n1", "n3", "n6"]);
  assert.deepEqual(ids(visibleNotes(NOTES, ["Sales", "Reading"], "")), ["n5", "n7"]);
  assert.deepEqual(ids(visibleNotes(NOTES, [SHARED], "")), ["n6"], "shared with me: notes someone else owns");
  assert.deepEqual(ids(visibleNotes(NOTES, [CHROME], "")), ["n5"]);
  assert.deepEqual(ids(visibleNotes(NOTES, [IMAGES], "")), ["n3", "n5"]);
  assert.deepEqual(ids(visibleNotes(NOTES, ["Nope"], "")), []);
});

test("the search reads title, text, labels, a link's title, site and address, and a clipped page's text and address", () => {
  assert.deepEqual(ids(visibleNotes(NOTES, [], "county")), ["n2"]);
  assert.deepEqual(ids(visibleNotes(NOTES, [], "LAWMATICS")), ["n4"], "case does not matter");
  assert.deepEqual(ids(visibleNotes(NOTES, [], "habla")), ["n5"]);
  assert.deepEqual(ids(visibleNotes(NOTES, [], "baileyandgalyen.com")), ["n5"]);
  assert.deepEqual(ids(visibleNotes(NOTES, [], "sales")), ["n7"], "labels count");
  assert.deepEqual(ids(visibleNotes(NOTES, ["Clients"], "field")), ["n4"], "search and filter together");
  assert.equal(matchesQuery(NOTES[0]!, "   "), true);
});

test("label counts follow the server's order, then labels only local notes have", () => {
  assert.deepEqual(labelCounts(NOTES, ["Lab 8", "Clients"]), [{ name: "Lab 8", count: 3 }, { name: "Clients", count: 3 }, { name: "Reading", count: 1 }, { name: "Sales", count: 1 }]);
  assert.deepEqual(labelCounts([], ["Partners"]), [{ name: "Partners", count: 0 }], "a label with no notes still lists");
});

test("the filter button says Labels, the one row, or the first and how many more", () => {
  assert.equal(filterLabel([]), "Labels");
  assert.equal(filterLabel(["Lab 8"]), "Lab 8");
  assert.equal(filterLabel([CHROME]), "From Chrome");
  assert.equal(filterLabel(["Lab 8", SHARED, IMAGES]), "Lab 8 and 2 more");
  assert.deepEqual(toggle(["a"], "b"), ["a", "b"]);
  assert.deepEqual(toggle(["a", "b"], "a"), ["b"]);
});

test("who sees a note, in words, and what agents may read", () => {
  assert.deepEqual(shareWords(NOTES[1]!, who), { icon: "lock", short: "", long: "Private" });
  assert.deepEqual(shareWords(NOTES[0]!, who), { icon: "people", short: "Aliza", long: "Shared with Aliza" });
  assert.equal(shareWords(NOTES[6]!, who).long, "Shared with My Legal Academy");
  assert.equal(shareWords(NOTES[4]!, who).long, "Shared with you by Aliza · you can edit");
  assert.match(agentWords(NOTES[1]!, who), /^Private\. Only you see it\./);
  assert.match(agentWords(NOTES[0]!, who), /Agents in channels cannot\.$/);
  assert.match(agentWords(NOTES[6]!, who), /any chat or channel in the Space/);
  assert.match(agentWords(NOTES[4]!, who), /^Aliza shared it with you/);
  assert.match(askWords(NOTES[1]!), /private note here/);
  assert.equal(askWords(NOTES[0]!), "Vyre reads it here because you can see it.");
});

test("a note's name falls back to its link or clip title; times read as the person's clock", () => {
  assert.equal(noteName(NOTES[5]!), "Custom fields: create, map to forms");
  assert.equal(noteName(note("x")), "Note");
  const now = Date.UTC(2026, 10, 3, 9, 14);
  assert.equal(whenWords(now - 5 * 60_000, now), "9:09");
  assert.equal(whenWords(now, now, 300), "14:14", "Pakistan is five hours ahead");
  assert.equal(whenWords(Date.UTC(2026, 10, 1, 12), now), "Sun");
  assert.equal(whenWords(Date.UTC(2026, 9, 28, 12), now), "Wed", "within the week, the day");
  assert.equal(whenWords(Date.UTC(2026, 9, 25, 12), now), "25 Oct");
  assert.equal(editedWords({ createdAt: now - 10_000, updatedAt: now - 10_000 }, now), "Edited just now");
  assert.equal(editedWords({ createdAt: now - 3_600_000, updatedAt: now - 3_600_000, clip: { url: "u", hasShot: false, at: now } }, now), "Clipped 8:14");
});

test("a change laid over a note, a note put back in its place, and which addresses the page opens", () => {
  const p = patchNote(NOTES[1]!, { title: "New" }, T0 + 5);
  assert.equal(p.title, "New");
  assert.equal(p.updatedAt, T0 + 5);
  assert.deepEqual(ids(upsert(NOTES.slice(0, 2), p)), ["n1", "n2"]);
  assert.deepEqual(ids(upsert(NOTES.slice(0, 2), note("n9"))), ["n9", "n1", "n2"]);
  assert.equal(openable("https://a.com/x"), "https://a.com/x");
  assert.equal(openable("baileyandgalyen.com/free-consultation"), "https://baileyandgalyen.com/free-consultation");
  assert.equal(openable("javascript:alert(1)"), null);
});

test("due days run from today to six days on, end of day in the person's zone, then no date", () => {
  const now = Date.UTC(2026, 10, 3, 4, 0);
  const d = dueChoices(now, 300);
  assert.deepEqual(d.map((x) => x.label), ["Today", "Tomorrow", "Thu 5 Nov", "Fri 6 Nov", "Sat 7 Nov", "Sun 8 Nov", "Mon 9 Nov", "No date"]);
  assert.equal(d[0]!.at, Date.UTC(2026, 10, 3, 23, 59, 59, 999) - 300 * 60_000);
  assert.equal(d[7]!.at, null);
});

test("a record type's fields: its title field, its summary, then text fields, four at most, filled from the note", () => {
  const client: RecordType = {
    key: "client", title: "Client", plural: "Clients", titleField: "name", summaryField: "notes",
    fields: [{ key: "stage", type: "choice", title: "Stage" }, { key: "name", type: "text", title: "Name" }, { key: "notes", type: "longtext", title: "Notes" }, { key: "email", type: "email", title: "Email" }, { key: "phone", type: "phone", title: "Phone" }, { key: "site", type: "url", title: "Site" }],
  };
  assert.deepEqual(recordFields(client).map((f) => f.key), ["name", "notes", "email", "phone"]);
  assert.deepEqual(fillFromNote(client, NOTES[1]!), { name: "Weinberger intake call", notes: "Joe wants PI leads routed by county" });
  assert.deepEqual(fillFromNote(client, note("x")), { name: "" });
});
