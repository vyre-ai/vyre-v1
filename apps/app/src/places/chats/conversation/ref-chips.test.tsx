import test from "node:test";
import assert from "node:assert/strict";
import { externalIds, idsIn, isExternalId, keysIn, refOfHref, resolveExternal, withKeys, withNames } from "./ref-chips.tsx";

const REC = "rec_01a1b2c3d4e5f6g7h8";

test("ids in a reply are found once each, by kind, and never inside code", () => {
  assert.deepEqual(idsIn(`I updated ${REC} and ${REC}, then file_01zzzzzzzzzz and \`rec_01code0000000\`.`), [{ id: REC, kind: "record" }, { id: "file_01zzzzzzzzzz", kind: "file" }]);
  assert.deepEqual(idsIn("```\nrec_01code0000000\n```"), []);
  assert.deepEqual(idsIn("no ids, just rec_ and user_01abc"), []);
  assert.equal(idsIn("task_01abcdefghij and thr_01abcdefghij")[1]!.kind, "chat");
});

test("an id is written as a link by its name; unknown, it is hidden and never the id", () => {
  const known = withNames(`Done: ${REC}.`, new Map([[REC, "Rivera Holdings"]]));
  assert.equal(known, "Done: [Rivera Holdings](https://ref.vyre.invalid/record/" + REC + ").");
  const unknown = withNames(`Done: ${REC}.`, new Map());
  assert.ok(!unknown.includes(`[${REC}`) && unknown.includes("[\u200b]"));
  assert.equal(withNames("see `" + REC + "`", new Map()), "see `" + REC + "`", "code stays as written");
  assert.deepEqual(refOfHref("https://ref.vyre.invalid/record/" + REC), { kind: "record", id: REC });
  assert.equal(refOfHref("https://example.com/x"), null);
});

test("the form agents are told to write, [[Name|id]], shows the name as a link and needs no lookup", () => {
  const text = `Updated [[Rivera Holdings|${REC}]] today.`;
  assert.deepEqual(idsIn(text), []);
  assert.equal(withNames(text, new Map()), "Updated [Rivera Holdings](https://ref.vyre.invalid/record/" + REC + ") today.");
});

test("blocks of a streaming reply: an id or [[Name|id]] in a text node becomes a chip link, code is untouched", async () => {
  const { refBlocks } = await import("./ref-chips.tsx");
  const blocks = [{ kind: "p" as const, key: "a", inline: [{ t: "text" as const, v: `Opened [[Dana Fox|${REC}]] and ` }, { t: "text" as const, v: `${REC}.` }, { t: "code" as const, v: REC }] }];
  const out = refBlocks(blocks, new Map([[REC, "Dana Fox"]]));
  const inl = (out[0] as { inline: Array<{ t: string; href?: string; c?: Array<{ v: string }>; v?: string }> }).inline;
  assert.deepEqual(inl.filter((n) => n.t === "link").map((n) => n.c![0]!.v), ["Dana Fox", "Dana Fox"]);
  assert.ok(inl.some((n) => n.t === "code" && n.v === REC), "code stays as written");
  assert.ok(!JSON.stringify(inl.filter((n) => n.t === "text")).includes("rec_"), "no raw id in the words");
});

test("a task's short key in chat is a link to it; a word that only looks like one, and code, stay as they are", () => {
  assert.deepEqual(keysIn("See VY-142 and VY-142, then ISO-9001. `VY-7` is code"), ["VY-142", "ISO-9001"]);
  const out = withKeys("See VY-142, not ISO-9001, and `VY-142`", new Map([["VY-142", "tsk_abc"]]));
  assert.ok(out.includes("[VY-142](https://ref.vyre.invalid/task/tsk_abc)"));
  assert.ok(out.includes("ISO-9001") && !out.includes("[ISO-9001]"));
  assert.ok(out.endsWith("`VY-142`"));
});

test("a real file id is a link, and a task key written where the name goes reads plainly", () => {
  assert.deepEqual(idsIn("see fil_01a19ad8256c4afc"), [{ id: "fil_01a19ad8256c4afc", kind: "file" }]);
  assert.match(withNames("[[notes.md|fil_01a19ad8256c4afc]]", new Map()), /^\[notes\.md\]\(https:\/\/ref\.vyre\.invalid\/file\/fil_01a19ad8256c4afc\)$/);
  assert.equal(withKeys("[[PE-4|First step]]", new Map()), "PE-4 First step");
  assert.equal(withKeys("`[[PE-4|First step]]`", new Map()), "`[[PE-4|First step]]`");
});

test("a link to a kind the chat cannot open shows its name, never the raw form", () => {
  assert.equal(withKeys("sent [[Asked plainly|eml_01a19b0aa7524816]]", new Map()), "sent Asked plainly");
});

test("an id inside a reference address is named by lookup and never rewritten; a bare person, note or task id is a chip or hidden", () => {
  const url = "https://ref.vyre.invalid/task/tsk_sirxsh97mm3gw1";
  assert.deepEqual(idsIn(`Open [Send Josh the link](${url}) now`), [{ id: "tsk_sirxsh97mm3gw1", kind: "task" }]);
  assert.equal(withNames(`Open [Send Josh the link](${url}) now`, new Map([["tsk_sirxsh97mm3gw1", "Send Josh the meeting link"]])), `Open [Send Josh the link](${url}) now`, "the address is left whole");
  assert.deepEqual(idsIn("ask usr_01abcdefghij about note_01abcdefghij").map((r) => r.kind), ["person", "note"]);
  const named = withNames("ask usr_01abcdefghij", new Map([["usr_01abcdefghij", "Sara Malik"]]));
  assert.equal(named, "ask [Sara Malik](https://ref.vyre.invalid/person/usr_01abcdefghij)");
  assert.match(withNames("ask usr_01abcdefghij", new Map()), /^ask \[\u200b\]\(/, "an id that does not resolve is a link with no words: nothing shows");
});

const THREAD = "1a189cd04d416be8";
const OWNER_TEXT = `See [[Claude in Chrome for Clio Grow... setup|${THREAD}]] for the steps.`;

test("an id from a tool result is an external id, a word and a task key are not", () => {
  assert.ok(isExternalId(THREAD) && isExternalId("cev_a1b2c3") && isExternalId("18c2a1f04e9b"));
  assert.ok(!isExternalId("Title") && !isExternalId("VY-142") && !isExternalId(REC));
  assert.deepEqual(externalIds(`${OWNER_TEXT} and \`[[x|${THREAD}]]\``), [THREAD]);
  assert.deepEqual(idsIn(OWNER_TEXT), [], "not a Vyre id, so no Vyre lookup");
});

test("a mail thread id that resolves is drawn as its chip, and opens through the mail kind", () => {
  const out = withNames(OWNER_TEXT, new Map(), new Map([[THREAD, "mail"]]));
  assert.equal(out, `See [Claude in Chrome for Clio Grow... setup](https://ref.vyre.invalid/mail/${THREAD}) for the steps.`);
  assert.deepEqual(refOfHref(`https://ref.vyre.invalid/mail/${THREAD}`), { kind: "mail", id: THREAD });
  assert.match(withNames("Meets [[Standup|cev_a1b2c3d4]]", new Map(), new Map([["cev_a1b2c3d4", "event"]])), /\(https:\/\/ref\.vyre\.invalid\/event\/cev_a1b2c3d4\)/);
});

test("an unknown id leaves the Name as plain words: never the brackets, never the id, never nothing", () => {
  for (const ext of [new Map<string, string | null>(), new Map<string, string | null>([[THREAD, null]])]) {
    const out = withNames(OWNER_TEXT, new Map(), ext);
    assert.equal(out, "See Claude in Chrome for Clio Grow... setup for the steps.");
    assert.ok(!out.includes("[[") && !out.includes(THREAD));
  }
  assert.equal(withNames("[[Rivera|not an id!]]", new Map()), "Rivera");
  assert.equal(withNames("[[VY-142|Fix the thing]]", new Map()), "[[VY-142|Fix the thing]]", "a key and a title are left for the key link");
});

test("streaming blocks do the same", async () => {
  const { refBlocks } = await import("./ref-chips.tsx");
  const blocks = [{ kind: "p" as const, key: "a", inline: [{ t: "text" as const, v: OWNER_TEXT }] }];
  const flat = (b: unknown): { t: string; href?: string; v?: string; c?: { v: string }[] }[] => (b as { inline: never[] }).inline;
  const yes = flat(refBlocks(blocks, new Map(), new Map([[THREAD, "mail"]]))[0]);
  assert.equal(yes.find((n) => n.t === "link")?.c?.[0]?.v, "Claude in Chrome for Clio Grow... setup");
  assert.equal(yes.find((n) => n.t === "link")?.href, `https://ref.vyre.invalid/mail/${THREAD}`);
  const no = flat(refBlocks(blocks, new Map(), new Map())[0]);
  assert.ok(!no.some((n) => n.t === "link"));
  assert.ok(no.map((n) => n.v ?? "").join("").includes("Claude in Chrome for Clio Grow... setup") && !no.map((n) => n.v ?? "").join("").includes("[["));
});

test("an id is resolved by the capability that reads it: mail thread, then calendar; neither means unknown", async () => {
  const calls: string[] = [];
  const mk = (ok: Record<string, unknown>) => ({ call: async (cap: string) => { calls.push(cap); if (cap in ok) return ok[cap]; throw new Error("nope"); } });
  assert.deepEqual(await resolveExternal(mk({ "mail.thread.get": { threadId: THREAD, subject: "Clio Grow setup" } }), THREAD), { kind: "mail", title: "Clio Grow setup" });
  assert.deepEqual(await resolveExternal(mk({ "google.calendar.get_event": { event: { summary: "Standup" } } }), "abc123def456xyz"), { kind: "event", title: "Standup" });
  assert.equal(await resolveExternal(mk({}), "zzz999zzz999"), null);
});
