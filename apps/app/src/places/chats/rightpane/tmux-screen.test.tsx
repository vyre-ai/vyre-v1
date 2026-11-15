// The full-screen terminal's screen: tmux's colours drawn, the cursor placed, a key press turned into the key tmux knows, and keys pressed together sent as one call in order.
import test from "node:test";
import assert from "node:assert/strict";
import { keyBatcher, keyToPress, nextShot, parseLine, sendKeys, withCursor } from "./TmuxScreen.tsx";
import type { Seat } from "./TmuxScreen.tsx";

test("keys: text, named keys, Ctrl and Alt chords, F keys; browser shortcuts and lone modifiers are not the terminal's", () => {
  assert.deepEqual(keyToPress({ key: "a" }), { text: "a" });
  assert.deepEqual(keyToPress({ key: "A", shiftKey: true }), { text: "A" });
  assert.deepEqual(keyToPress({ key: "é" }), { text: "é" });
  assert.deepEqual(keyToPress({ key: " " }), { text: " " });
  for (const [k, want] of [
    ["Enter", "Enter"],
    ["Tab", "Tab"],
    ["Backspace", "BSpace"],
    ["Escape", "Escape"],
    ["ArrowUp", "Up"],
    ["ArrowLeft", "Left"],
    ["Delete", "DC"],
    ["PageDown", "PageDown"],
    ["F5", "F5"],
  ] as const)
    assert.deepEqual(keyToPress({ key: k }), { key: want }, k);
  assert.deepEqual(keyToPress({ key: "Tab", shiftKey: true }), { key: "BTab" });
  assert.deepEqual(keyToPress({ key: "c", ctrlKey: true }), { key: "C-c" });
  assert.deepEqual(keyToPress({ key: "D", ctrlKey: true, shiftKey: true }), { key: "C-d" });
  assert.deepEqual(keyToPress({ key: "b", altKey: true }), { key: "M-b" });
  assert.equal(keyToPress({ key: "c", metaKey: true }), null, "Cmd+C is the browser's copy");
  for (const k of ["Shift", "Control", "Alt", "Meta", "CapsLock", "Dead", "Unidentified"])
    assert.equal(keyToPress({ key: k }), null, k);
});

test("keys go one request at a time, in order; what is pressed while one is in flight goes together when it lands, letters joined", async () => {
  const calls: unknown[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  const b = keyBatcher(async (ks) => {
    calls.push(ks);
    if (calls.length === 1) await gate;
  });
  b.push({ text: "g" });
  b.push({ text: "h" });
  b.push({ key: "Enter" });
  b.push({ paste: "4F2A-91CD" });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls, [[{ text: "gh" }, { key: "Enter" }, { paste: "4F2A-91CD" }]], "same tick: one call");
  b.push({ key: "Up" });
  b.push({ text: "l" });
  b.push({ text: "s" });
  b.push({ key: "Enter" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.length, 1, "nothing new is sent while the first is in flight");
  release();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.deepEqual(calls[1], [{ key: "Up" }, { text: "ls" }, { key: "Enter" }], "the rest went together, in order");
  assert.equal(calls.length, 2);
});

test("colours: basic, bright, 256 and true colour, bold, inverse; reset ends them; other escapes are dropped", () => {
  const e = "\x1b";
  const l = parseLine(
    `${e}[31mred${e}[0m plain ${e}[1;38;5;196mbright${e}[0m ${e}[38;2;1;2;3mtrue${e}[0m${e}[?25l${e}[7mrev${e}[27m`,
  );
  assert.deepEqual(
    l.map((s) => [s.text, s.color, s.bold, s.inverse]),
    [
      ["red", "#e06c75", undefined, undefined],
      [" plain ", undefined, undefined, undefined],
      ["bright", "rgb(255,0,0)", true, undefined],
      [" ", undefined, undefined, undefined],
      ["true", "rgb(1,2,3)", undefined, undefined],
      ["rev", undefined, undefined, true],
    ],
  );
  assert.equal(
    parseLine("plain text")
      .map((s) => s.text)
      .join(""),
    "plain text",
  );
});

test("the cursor marks the character under it, splitting a run, and stands on a space past the end of the line", () => {
  const sp = parseLine("$ ls");
  assert.deepEqual(
    withCursor(sp, 2).map((s) => [s.text, s.cursor === true]),
    [
      ["$ ", false],
      ["l", true],
      ["s", false],
    ],
  );
  assert.deepEqual(
    withCursor(sp, 6).map((s) => [s.text, s.cursor === true]),
    [
      ["$ ls", false],
      ["  ", false],
      [" ", true],
    ],
  );
  assert.deepEqual(
    withCursor([], 0).map((s) => [s.text, s.cursor === true]),
    [[" ", true]],
  );
});

test("after exit the last screen stays: a failed capture, an empty answer or an error object never replaces it", () => {
  const good = { text: "$ ls\nREADME.md", cols: 80, rows: 24, cursor: { x: 0, y: 2 }, history: 0, hidden: false };
  assert.equal(nextShot(null, good), good, "the first screen is drawn");
  for (const bad of [undefined, null, {}, { error: "can't find session" }, { text: 5 }, "gone"])
    assert.equal(nextShot(good, bad), good, `kept against ${JSON.stringify(bad)}`);
  assert.equal(nextShot(good, { ...good }), good, "the same screen changes nothing");
  assert.equal(nextShot(good, { ...good, text: "$ exit" })?.text, "$ exit", "a real new screen replaces it");
});

// ---- a batch of keys is sent under one key and one number, and never again once it was answered (15 Nov, rc.29)

const makeSeat = (): Seat & { next: number; resets: number; lease: string } => {
  const seat = {
    next: 1,
    resets: 0,
    lease: "lse_a",
    async get() {
      return { lease: seat.lease, seq: seat.next };
    },
    advance(seq: number) {
      if (seat.next === seq) seat.next = seq + 1;
    },
    reset() {
      seat.resets += 1;
    },
  };
  return seat;
};
const err = (code: string, reason?: string) =>
  Object.assign(new Error(code), { code, ...(reason ? { details: { reason } } : {}) });
const deps = (call: (cap: string, input: unknown) => Promise<unknown>, seat: Seat, holding = () => true) => ({
  call,
  terminalId: "trm_1",
  seat,
  newKey: (() => {
    let n = 0;
    return () => `key-${++n}`;
  })(),
  holding,
  sleep: async () => undefined,
});

test("a batch whose answer was lost is sent again with the SAME key and number; one that was answered is never sent again", async () => {
  const seat = makeSeat();
  const seen: Array<{ key: string; seq: number }> = [];
  let tries = 0;
  const call = async (_cap: string, input: unknown) => {
    const i = input as { idempotencyKey: string; seq: number };
    seen.push({ key: i.idempotencyKey, seq: i.seq });
    if (++tries <= 2) throw new Error("network lost");
    return { ok: true, screen: { text: "$ echo one" } };
  };
  const r = await sendKeys(deps(call, seat), [{ text: "echo one" }]);
  assert.equal(r.sent, true);
  assert.deepEqual(seen, [
    { key: "key-1", seq: 1 },
    { key: "key-1", seq: 1 },
    { key: "key-1", seq: 1 },
  ]);
  assert.equal(seat.next, 2, "the number moves on once it was answered");
  // the next batch has a new key and the next number
  await sendKeys(deps(call, seat), [{ key: "Enter" }]);
  assert.equal(seen[3]?.seq, 2, "the next batch carries the next number");
});

test("an answer that says no, or that the server recorded as a failure, is final: no resend, and the count is asked again", async () => {
  for (const [code, reason] of [
    ["validation.precondition_failed", "seq_gap"],
    ["validation.precondition_failed", "lease_old"],
    ["validation.precondition_failed", "keyboard_held"],
    ["permission.no_grant", undefined],
    ["internal.unexpected", undefined],
  ] as const) {
    const seat = makeSeat();
    let calls = 0;
    const r = await sendKeys(
      deps(async () => {
        calls++;
        throw err(code, reason);
      }, seat),
      [{ text: "rm -rf build" }],
    );
    assert.equal(r.sent, false);
    assert.equal(calls, 1, `${code} ${reason ?? ""}: sent once`);
    assert.equal(seat.resets, 1, "the count is asked again before the next batch");
    assert.equal(seat.next, 1);
  }
});

test("a repeat the server says is still being sent is asked again with the same key", async () => {
  const seat = makeSeat();
  const keys: string[] = [];
  let n = 0;
  const r = await sendKeys(
    deps(async (_c, input) => {
      keys.push((input as { idempotencyKey: string }).idempotencyKey);
      if (++n < 3) throw err("validation.precondition_failed", "in_flight");
      return { ok: true };
    }, seat),
    [{ text: "x" }],
  );
  assert.equal(r.sent, true);
  assert.deepEqual(keys, ["key-1", "key-1", "key-1"]);
});

test("the resend stops when the keyboard is no longer ours (given back, lost): a lost batch is not sent into what the agent runs now", async () => {
  const seat = makeSeat();
  let held = true;
  let calls = 0;
  const r = await sendKeys(
    deps(
      async () => {
        calls++;
        held = false; // the person handed it back while this call was on its way
        throw new Error("network lost");
      },
      seat,
      () => held,
    ),
    [{ text: "echo one" }],
  );
  assert.equal(r.sent, false);
  assert.equal(calls, 1);
  assert.equal(seat.resets, 1);
});

test("with no take-over to type under nothing is sent", async () => {
  let calls = 0;
  const r = await sendKeys(
    deps(
      async () => {
        calls++;
        return { ok: true };
      },
      { get: async () => null, advance: () => undefined, reset: () => undefined },
    ),
    [{ text: "x" }],
  );
  assert.equal(r.sent, false);
  assert.equal(calls, 0);
});

test("a batch that did not arrive says so in one plain line (the server's own words, or ours); a batch that arrives says nothing", async () => {
  const words = "Some keys before these did not arrive. Take the keyboard again to type.";
  const gap = await sendKeys(
    deps(async () => {
      throw Object.assign(new Error(words), { code: "validation.precondition_failed", details: { reason: "seq_gap" } });
    }, makeSeat()),
    [{ text: "x" }],
  );
  assert.equal(gap.said, words);
  const failed = await sendKeys(
    deps(async () => {
      throw Object.assign(new Error(""), { code: "internal.unexpected" });
    }, makeSeat()),
    [{ text: "x" }],
  );
  assert.equal(failed.said, "Those keys may not have arrived.");
  let held = true;
  const gone = await sendKeys(
    deps(
      async () => {
        held = false;
        throw new Error("network lost");
      },
      makeSeat(),
      () => held,
    ),
    [{ text: "x" }],
  );
  assert.equal(gone.said, "The keyboard is no longer yours.");
  const ok = await sendKeys(
    deps(async () => ({ ok: true }), makeSeat()),
    [{ text: "x" }],
  );
  assert.equal(ok.said, undefined);
});
