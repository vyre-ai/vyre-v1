// @nocache  (these tests start real processes, the stand-in engine agent/fixtures/golden-streams/fake-cli.mjs)
// Helpers an engine starts in the BACKGROUND (owner's rc.28 report, 16 Nov 2026): the launch is not the end. The session tells the host when each one starts, works and ends, even after the turn that started it
// is over; it is not idle while any runs; the agent is woken ONCE when the last one has ended, and what the engine says to the first ones is not an answer.
import test from "node:test";
import assert from "node:assert/strict";
import { CLI_ADAPTERS, createCliDriver } from "../src/drivers/cli/index.ts";
import type { CliDriverDeps } from "../src/drivers/cli/index.ts";
import { collect, driverDeps, kinds, newSpy, specOf, texts, turnOf, until } from "../fixtures/golden-streams/rig.ts";

type Task = Parameters<NonNullable<ReturnType<NonNullable<CliDriverDeps["background"]>>["task"]>>[0];

function rig(over: Partial<CliDriverDeps> = {}) {
  const tasks: Task[] = [];
  let woken = 0;
  const driver = createCliDriver(
    CLI_ADAPTERS.claude_code,
    driverDeps(newSpy(), {
      background: () => ({ task: (t) => tasks.push(t), done: () => (woken += 1) }),
      ...over,
    }),
  );
  return { driver, tasks, woken: () => woken };
}

test("a helper launched in the background is not finished at launch: the turn ends, the session is busy, the host is told as each ends, and the wake comes once", async () => {
  const { driver, tasks, woken } = rig();
  const session = await driver.open(specOf());
  try {
    const first = await collect(session.send(turnOf("bg 150 300 450")));
    // the launch results say started, not done, and carry no answer
    const results = first.filter((e) => e.type === "block" && e.kind === "tool_result");
    assert.equal(results.length, 3);
    for (const r of results) {
      assert.equal((r as { payload: { launched?: boolean } }).payload.launched, true);
      assert.equal("result" in (r as { payload: object }).payload, false);
    }
    assert.equal(JSON.stringify(first).includes("Async agent launched"), false);
    assert.deepEqual(texts(first), ["I am waiting for all of them."]);
    assert.equal(session.background, 3, "three helpers still work: the session is not idle");
    assert.equal(woken(), 0);

    await until(() => woken() === 1, 4000);
    assert.equal(session.background, 0);
    const ends = tasks.filter((t) => t.state === "end");
    assert.deepEqual(
      ends.map((t) => [t.id, t.ok, t.text]),
      [
        ["toolu_bg1", true, "Helper 1 found 3 rows"],
        ["toolu_bg2", true, "Helper 2 found 3 rows"],
        ["toolu_bg3", true, "Helper 3 found 3 rows"],
      ],
    );
    assert.ok(tasks.some((t) => t.state === "progress" && t.text === "Searching the web"));

    // the wake turn reads the engine's own continuation: ONE answer, the last, never a line per helper
    const wake = await collect(session.send(turnOf("", { wake: true })));
    assert.deepEqual(texts(wake), ["All 3 helpers are back."]);
    assert.equal(wake.at(-1)?.type, "done");
    assert.equal(woken(), 1, "woken once, not once per helper");
  } finally {
    await session.close();
  }
});

test("an engine that does not wake itself is woken by the host's message, once", async () => {
  const { driver, woken } = rig({ attachMs: 300 });
  const session = await driver.open(specOf());
  try {
    await collect(session.send(turnOf("bg 100 200 noself")));
    await until(() => woken() === 1, 4000);
    const wake = await collect(session.send(turnOf("(continue)", { wake: true })));
    assert.match(texts(wake).join(""), /every helper you started in the background has finished/);
    assert.equal(kinds(wake).at(-1), "done");
  } finally {
    await session.close();
  }
});

test("a person writing while helpers work gets a turn of its own: the engine's reply to a helper is not taken for its end", async () => {
  const { driver, tasks, woken } = rig();
  const session = await driver.open(specOf());
  try {
    await collect(session.send(turnOf("bg 400 800")));
    assert.equal(session.background, 2);
    const mine = await collect(session.send(turnOf("how many are done")));
    assert.deepEqual(texts(mine), ["how many are done"]);
    assert.equal(session.background, 2 - tasks.filter((t) => t.state === "end").length);
    assert.equal(woken(), 0);
  } finally {
    await session.close();
  }
});

test("stopping the session ends the helpers with it: each is told as stopped and the session is idle", async () => {
  const { driver, tasks } = rig();
  const session = await driver.open(specOf());
  await collect(session.send(turnOf("bg 5000 6000")));
  assert.equal(session.background, 2);
  await session.cancel();
  await until(() => session.background === 0);
  assert.deepEqual(
    tasks.filter((t) => t.state === "end").map((t) => [t.id, t.stopped]),
    [
      ["toolu_bg1", true],
      ["toolu_bg2", true],
    ],
  );
  await session.close();
});
