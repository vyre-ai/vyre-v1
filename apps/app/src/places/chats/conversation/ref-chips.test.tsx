import test from "node:test";
import assert from "node:assert/strict";
import { idsIn, refOfHref, withNames } from "./ref-chips.tsx";

const REC = "rec_01a1b2c3d4e5f6g7h8";

test("ids in a reply are found once each, by kind, and never inside code", () => {
  assert.deepEqual(idsIn(`I updated ${REC} and ${REC}, then file_01zzzzzzzzzz and \`rec_01code0000000\`.`), [{ id: REC, kind: "record" }, { id: "file_01zzzzzzzzzz", kind: "file" }]);
  assert.deepEqual(idsIn("```\nrec_01code0000000\n```"), []);
  assert.deepEqual(idsIn("no ids, just rec_ and user_01abc"), []);
  assert.equal(idsIn("task_01abcdefghij and thr_01abcdefghij")[1]!.kind, "chat");
});

test("an id is written as a link by its name; unknown, it says what it is and never the id", () => {
  const known = withNames(`Done: ${REC}.`, new Map([[REC, "Rivera Holdings"]]));
  assert.equal(known, "Done: [Rivera Holdings](https://ref.vyre.invalid/record/" + REC + ").");
  const unknown = withNames(`Done: ${REC}.`, new Map());
  assert.ok(!unknown.includes(`[${REC}`) && unknown.includes("[a record]"));
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
