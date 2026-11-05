// The pure half of the app updating itself: the start's decision, version order, the progress words, the toggle and What's new once per version.
import test from "node:test";
import assert from "node:assert/strict";
import { AUTO_KEY, FROM_KEY, SEEN_KEY, autoUpdateOn, bytes, checkedLabel, decide, fraction, isNewer, markSeen, noteLines, noteUpdateFrom, parseWhatsNew, progressLine, setAutoUpdate, whatsNewToShow } from "./model.ts";
import type { Store, UpdateCheck } from "./model.ts";

const mem = (init: Record<string, string> = {}): Store & { data: Map<string, string> } => {
  const data = new Map(Object.entries(init));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
};
const check = (o: Partial<UpdateCheck> = {}): UpdateCheck => ({ phase: "available", current: "1.0.0-rc.16", channel: "beta", version: "1.0.0-rc.17", notes: null, checkedAt: 1, ...o });

test("a newer version updates on start with the toggle on, and waits as an offer with it off", () => {
  assert.equal(decide(check(), true), "update");
  assert.equal(decide(check(), false), "offer");
});

test("an older or equal version, nothing found, a failed check or no answer yet is nothing: the start goes on", () => {
  assert.equal(decide(check({ version: "1.0.0-rc.16" }), true), "none", "equal");
  assert.equal(decide(check({ version: "1.0.0-rc.15" }), true), "none", "older");
  assert.equal(decide(check({ current: "1.0.0", version: "1.0.0-rc.17" }), true), "none", "a release never goes back to its own release candidate");
  assert.equal(decide(check({ phase: "none", version: null }), true), "none");
  assert.equal(decide(check({ phase: "failed", version: null }), true), "none", "offline or the check failed");
  assert.equal(decide(check({ phase: "checking", version: null }), true), "none", "not in time");
  assert.equal(decide(null, true), "none");
});

test("version order is semver: numbers, then a prerelease below its release, numeric parts numerically", () => {
  const newer: Array<[string, string]> = [["1.0.0-rc.16", "1.0.0-rc.17"], ["1.0.0-rc.9", "1.0.0-rc.10"], ["1.0.0-rc.17", "1.0.0"], ["1.0.0", "1.0.1"], ["1.9.0", "1.10.0"], ["1.0.0-beta.3", "1.0.0-rc.1"], ["0.9.9", "1.0.0-rc.1"], ["v1.0.0", "1.0.1"]];
  for (const [a, b] of newer) { assert.equal(isNewer(a, b), true, `${b} > ${a}`); assert.equal(isNewer(b, a), false, `${a} < ${b}`); }
  for (const v of ["1.0.0", "1.0.0-rc.17"]) assert.equal(isNewer(v, v), false);
  assert.equal(isNewer("1.0.0", "nonsense"), false);
  assert.equal(isNewer("nonsense", "1.0.0"), false);
});

test("the toggle is on by default and only an explicit off turns it off", () => {
  const s = mem();
  assert.equal(autoUpdateOn(s), true);
  assert.equal(autoUpdateOn(null), true);
  setAutoUpdate(s, false);
  assert.equal(s.data.get(AUTO_KEY), "0");
  assert.equal(autoUpdateOn(s), false);
  setAutoUpdate(s, true);
  assert.equal(autoUpdateOn(s), true);
  const broken: Store = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => undefined };
  assert.equal(autoUpdateOn(broken), true);
  assert.doesNotThrow(() => setAutoUpdate(broken, false));
});

test("the bar and its line: real bytes and percent while it downloads, then each step in words", () => {
  assert.equal(progressLine(null), "Starting the download");
  const mb = 1024 * 1024;
  assert.equal(progressLine({ phase: "download", downloaded: 12.4 * mb, total: 128 * mb }), "12.4 MB of 128 MB, 9%");
  assert.equal(progressLine({ phase: "download", downloaded: 300 * 1024, total: null }), "300 KB downloaded");
  assert.equal(fraction({ phase: "download", downloaded: 64 * mb, total: 128 * mb }), 0.5);
  assert.equal(fraction({ phase: "download", downloaded: 1, total: null }), null, "an unknown size runs the bar instead");
  assert.equal(fraction({ phase: "installing", downloaded: 0, total: null }), 1);
  assert.equal(progressLine({ phase: "verify", downloaded: 0, total: null }), "Checking the release signature");
  assert.equal(progressLine({ phase: "waiting", downloaded: 0, total: null, turns: 1 }), "Waiting for a reply on this computer to finish");
  assert.equal(progressLine({ phase: "waiting", downloaded: 0, total: null, turns: 2 }), "Waiting for 2 replies on this computer to finish");
  assert.equal(progressLine({ phase: "restarting", downloaded: 0, total: null }), "Opening the new Vyre");
  assert.equal(bytes(5 * 1024), "5 KB");
  assert.equal(bytes(130 * mb), "130 MB");
});

test("What's new shows once per version after an update, never on a fresh install, never with nothing to say", () => {
  const notes = { version: "1.0.0-rc.17", lines: ["Vyre updates itself."] };
  const fresh = mem();
  assert.equal(whatsNewToShow(fresh, notes), null, "the first open of a new install is not an update");
  assert.equal(fresh.data.get(SEEN_KEY), "1.0.0-rc.17");
  const updated = mem({ [SEEN_KEY]: "1.0.0-rc.16" });
  assert.deepEqual(whatsNewToShow(updated, notes), notes);
  assert.deepEqual(whatsNewToShow(updated, notes), notes, "it waits until Continue");
  markSeen(updated, notes.version);
  assert.equal(whatsNewToShow(updated, notes), null, "and never again for this version");
  const empty = mem({ [SEEN_KEY]: "1.0.0-rc.16" });
  assert.equal(whatsNewToShow(empty, { version: "1.0.0-rc.17", lines: [] }), null);
  assert.equal(empty.data.get(SEEN_KEY), "1.0.0-rc.17");
});

test("the first update of an install from before this feature still shows it: the shell's note of where it came from", () => {
  const s = mem();
  noteUpdateFrom(s, "1.0.0-rc.16");
  assert.equal(s.data.get(FROM_KEY), "1.0.0-rc.16");
  assert.deepEqual(whatsNewToShow(s, { version: "1.0.0-rc.17", lines: ["Better."] })?.lines, ["Better."]);
  markSeen(s, "1.0.0-rc.17");
  assert.equal(s.data.get(FROM_KEY), undefined, "Continue clears the note");
});

test("the feed's notes become lines, and a notes field that only names the version is nothing", () => {
  assert.deepEqual(noteLines("Vyre updates itself.\n- Calmer start.\n\n"), ["Vyre updates itself.", "Calmer start."]);
  assert.deepEqual(noteLines("Vyre 1.0.0-rc.17"), []);
  assert.deepEqual(noteLines(null), []);
  assert.equal(parseWhatsNew({ version: "1", lines: ["a", 2, " ", " b "] })?.lines.join("|"), "a|b");
  assert.equal(parseWhatsNew({ lines: [] }), null);
  assert.equal(parseWhatsNew("x"), null);
});

test("the last check reads as a time", () => {
  assert.equal(checkedLabel(null, 0), "Not checked yet");
  assert.equal(checkedLabel(0, 10_000), "Checked just now");
  assert.equal(checkedLabel(0, 5 * 60_000), "Checked 5 min ago");
  assert.equal(checkedLabel(0, 3 * 3_600_000), "Checked 3 hours ago");
});

test("the wait: the countdown clock, the chats it names, and the lines for waiting and stopping", async () => {
  const { clock, chatsWords, progressLine } = await import("./model.ts");
  assert.deepEqual([clock(522), clock(60), clock(59.2), clock(0), clock(-3)], ["8:42", "1:00", "1:00", "0:00", "0:00"]);
  assert.equal(chatsWords(["Rivera intake"], 1), "the reply in \u201cRivera intake\u201d");
  assert.equal(chatsWords(["A", "B"], 2), "the replies in \u201cA\u201d and \u201cB\u201d");
  assert.equal(chatsWords(["A", "B", "C"], 3), "the replies in \u201cA\u201d and 2 other chats");
  assert.equal(chatsWords([], 3), "3 replies");
  assert.equal(chatsWords(undefined, 1), "a reply");
  assert.equal(progressLine({ phase: "waiting", downloaded: 0, total: null, turns: 1, chats: ["Rivera intake"] }), "Waiting for the reply in \u201cRivera intake\u201d to finish");
  assert.equal(progressLine({ phase: "waiting", downloaded: 0, total: null, turns: 1 }), "Waiting for a reply on this computer to finish");
  assert.equal(progressLine({ phase: "stopping", downloaded: 0, total: null, turns: 2 }), "Stopped the replies cleanly. Getting ready to install");
  assert.equal(progressLine({ phase: "stopping", downloaded: 0, total: null, turns: 1 }), "Stopped the reply cleanly. Getting ready to install");
  const { fraction } = await import("./model.ts");
  assert.equal(fraction({ phase: "waiting", downloaded: 0, total: null, left: 300, of: 600 }), 0.5, "the bar is the time left");
  assert.equal(fraction({ phase: "waiting", downloaded: 0, total: null, left: 600, of: 600 }), 1, "at the start of the wait it is the whole cap, and it only drains");
  assert.equal(fraction({ phase: "waiting", downloaded: 0, total: null, left: 0, of: 600 }), 0, "empty when the cap is up");
  assert.equal(fraction({ phase: "waiting", downloaded: 0, total: null, turns: 1 }), null, "no cap known: the quiet indeterminate bar, never full");
  assert.equal(fraction({ phase: "installing", downloaded: 0, total: null }), 1);
  assert.equal(progressLine({ phase: "stopping", downloaded: 0, total: null }), "Getting ready to install");
});
