import assert from "node:assert/strict";
import { test } from "node:test";
import { shortTimeIn } from "./time.ts";
import { ERROR_WORDS, creditOf, describeError, expandWords, formatActivity, looksLikeCode, plainSentence, problemWords, shortTime, atToken, whoToken } from "./index.ts";
import type { Viewer } from "./index.ts";

const NAMES: Record<string, string> = { usr_irfad: "Irfad Imtiaz", usr_omar: "Omar Reyes", agt_dex: "Dex", agt_omar_cc: "Omar Reyes (Agent)", agt_assistant: "Assistant" };
const viewer = (me: string, offsetMin = 300): Viewer => ({ me, nameOf: (id) => NAMES[id] ?? "Someone", offsetMin });
const WED = Date.UTC(2026, 10, 11, 11, 16);   // Wed 11 Nov 2026 11:16 UTC = 16:16 in PKT

test("a time reads once, short, in the reader's zone", () => {
  assert.equal(shortTime(WED, 300), "Wed 11 Nov, 4:16 PM");
  assert.equal(shortTime(WED, 0), "Wed 11 Nov, 11:16 AM");
  assert.equal(expandWords(`Started. Due ${atToken(WED)}.`, viewer("usr_irfad")), "Started. Due Wed 11 Nov, 4:16 PM.");
});

test("the reader is 'you', anyone else is named, and a sentence start is capitalised", () => {
  const t = `${whoToken("agt_dex")} drafted this goal for ${whoToken("usr_irfad")}.`;
  assert.equal(expandWords(t, viewer("usr_irfad")), "Dex drafted this goal for you.");
  assert.equal(expandWords(t, viewer("usr_omar")), "Dex drafted this goal for Irfad Imtiaz.");
  assert.equal(expandWords(`${whoToken("usr_irfad")} made this goal.`, viewer("usr_irfad")), "You made this goal.");
});

test("credit: a Space agent by its name, the reader as You, another person's private agent as its person, the server as Vyre", () => {
  assert.equal(creditOf("agt_dex>usr_irfad", viewer("usr_irfad")), "Dex");
  assert.equal(creditOf("agt_dex", viewer("usr_omar")), "Dex");
  assert.equal(creditOf("usr_irfad", viewer("usr_irfad")), "You");
  assert.equal(creditOf("agt_omar_cc>usr_omar", viewer("usr_irfad")), "Omar Reyes (Agent)");
  assert.equal(creditOf("svc_host", viewer("usr_irfad")), "Vyre");
  assert.equal(creditOf(undefined, viewer("usr_irfad")), "");
});

test("snapshot: the main goal feed lines", () => {
  const v = viewer("usr_irfad");
  const lines = [
    { text: `${whoToken("agt_dex")} drafted this goal for ${whoToken("usr_irfad")}.`, by: "agt_dex>usr_irfad" },
    { text: `Started. Due ${atToken(WED)}.`, by: "usr_irfad" },
    { text: `${whoToken("agt_dex")} was woken because it is time for a check-in.`, by: "svc_host" },
    { text: `${whoToken("usr_omar")} was mentioned in the goal chat and can now open its folder.`, by: "usr_irfad" },
    { text: "Moved from Planning to Active.", by: "svc_host" },
  ].map((e) => formatActivity({ ...e, at: WED }, v));
  assert.deepEqual(lines.map((l) => `${l.credit}: ${l.text}`), [
    "Dex: Dex drafted this goal for you.",
    "You: Started. Due Wed 11 Nov, 4:16 PM.",
    "Vyre: Dex was woken because it is time for a check-in.",
    "You: Omar Reyes was mentioned in the goal chat and can now open its folder.",
    "Vyre: Moved from Planning to Active.",
  ]);
});

test("a stored sentence with no token reads as stored, and tpl wins when the server sent both", () => {
  const v = viewer("usr_irfad");
  assert.equal(formatActivity({ text: "Done: Pull the list", at: WED }, v).text, "Done: Pull the list");
  assert.equal(formatActivity({ text: "Started. Due Wed 11 Nov, 11:16.", tpl: `Started. Due ${atToken(WED)}.`, at: WED }, v).text, "Started. Due Wed 11 Nov, 4:16 PM.");
});

test("code-like text is caught: ids, error codes, tool names, snake_case, traces", () => {
  for (const bad of ["Ask usr_ab12cd for it", "permission.not_found", "Use tasks.assign for work.", "Choose keep_a or drop.", "trace 7a3f00c9d1e2b4", "agt_dex is busy"]) assert.equal(looksLikeCode(bad), true, bad);
  for (const ok of ["You can only make a goal for yourself.", "Open agent.toml in the editor.", "Save it as report.pdf.", "Wed 11 Nov, 4:16", "Visit ranql.com today."]) assert.equal(looksLikeCode(ok), false, ok);
});

test("every catalog line is plain: a sentence, no code-like token, no em dash, a next step", () => {
  for (const [code, w] of Object.entries(ERROR_WORDS)) {
    for (const s of [w.what, w.next]) {
      assert.equal(looksLikeCode(s), false, `${code}: ${s}`);
      assert.equal(s.includes("—"), false, code);
      assert.match(s, /^[A-Z].*[.]$/, `${code}: ${s}`);
    }
  }
});

test("describeError keeps a plain raised message, and swaps one that carries a code or an id", () => {
  assert.equal(describeError("validation.bad_input", { message: "Pick another person for the channel." }).text, "Pick another person for the channel.");
  assert.equal(describeError("validation.bad_input", { message: "Use tasks.assign for work." }).text, ERROR_WORDS["validation.bad_input"]!.what);
  assert.equal(describeError("permission.no_grant", { message: "you cannot export this" }).text, "You cannot export this.");
  const d = describeError("permission.not_found", { traceId: "tr_7a3f00" });
  assert.equal(d.text, ERROR_WORDS["permission.not_found"]!.what);
  assert.equal(d.details, "permission.not_found · tr_7a3f00");
  assert.equal(looksLikeCode(d.text), false);
  assert.equal(describeError("nothing.known").text, ERROR_WORDS["internal.unexpected"]!.what);
});

test("problemWords: machine talk never reaches a person", () => {
  assert.equal(problemWords(new TypeError("Cannot read properties of undefined (reading 'id')")).text, ERROR_WORDS["internal.unexpected"]!.what);
  assert.equal(problemWords(new Error("fetch failed")).text, "We could not reach the server.");
  assert.equal(problemWords(new Error("Sign in first"), "x").text, "Sign in first.");
  assert.equal(problemWords({ code: "validation.not_found", message: "no such record type", traceId: "tr_1" }).text, "No such record type.");
  assert.equal(plainSentence("that invite is no longer open"), "That invite is no longer open.");
});

test("a feed line in a zone reads in it, 12 hour, daylight saving included, never as raw UTC", () => {
  const v = { me: "usr_irfad", nameOf: (id: string) => id, offsetMin: 0, zone: "America/Los_Angeles" };
  assert.equal(shortTimeIn(WED, "America/Los_Angeles"), "Wed 11 Nov, 3:16 AM");
  assert.equal(expandWords(`Started. Due ${atToken(WED)}.`, v), "Started. Due Wed 11 Nov, 3:16 AM.", "the zone wins over a fixed offset");
  assert.equal(shortTimeIn(Date.UTC(2026, 6, 11, 11, 16), "America/Los_Angeles"), "Sat 11 Jul, 4:16 AM", "summer time");
});
