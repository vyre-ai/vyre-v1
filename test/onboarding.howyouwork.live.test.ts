// @tsx
// The How you work step as a talk with the Assistant, in a real browser (rc.29, row 8). A Personal Space with an AI account connected and a scripted model: the Assistant is led by the focus skill
// (the walk checks that the instructions reach the model), the three questions are asked one at a time, each answer lands in the person's memory as a fact of the card's own shape (read back through
// memory.facts.list), "Vyre knows" lists the lines, an edit of one line is saved, and the step shows done. Pictures go to VYRE_HOWYOUWORK_SHOTS (light and dark, desktop and phone).
// Needs Node 24, a Chromium and VYRE_APP_DIST; without them it skips and says why (VYRE_REQUIRE_CHROME=1 makes that a failure).
import test from "node:test";
import assert from "node:assert/strict";
import { createCapCaller } from "../client/src/gateway/index.ts";
import { bootScreens, browserOrSkip, open, seat } from "./support/mail-browser.ts";
import { shoot } from "./support/chat-shots.ts";
import { scriptedModel } from "./support/live.ts";
import { saveApiKey } from "../apps/app/src/onboarding/connect-ai.ts";
import { loadFlow, markStep } from "../apps/app/src/onboarding/store.ts";
import type { CapCall } from "../apps/app/src/shell/session/caps.ts";

const OUT = process.env["VYRE_HOWYOUWORK_SHOTS"] ?? "shots-evidence/onboarding-howyouwork";
// a made-up key for the model stand-in; the stand-in provider accepts any key without "invalid" in it
const KEY = "sk-ant-howyouwork-test-key-0001";

type Fact = { factId: string; text: string; status: string; sourceKind?: string; sourceRef?: string };
const seen: { body: string; instructed: boolean }[] = [];
let turn = 0;
const SAYS = [
  { fact: "Works as: planner", reply: "Got it, a planner. Which tools do you use every day?" },
  {
    fact: "Uses every day: Gmail, Sheets",
    reply: "Gmail and Sheets, noted. How should I talk to you: short, or in detail?",
  },
  {
    fact: "Prefers answers that are: Short and to the point",
    reply: "Saved: planner, Gmail and Sheets, short answers. Change any line in the Vyre knows list.",
  },
];
const model = scriptedModel(async function* (input, run) {
  const at = turn++;
  seen.push({
    body: input.trigger?.body ?? "",
    instructed: /never more than three/.test(JSON.stringify(input.context ?? {})),
  });
  const say = SAYS[Math.min(at, SAYS.length - 1)]!;
  yield* run("memory_propose", {
    layer: "person",
    text: say.fact,
    sourceKind: "manual",
    sourceRef: "onboarding",
    kind: "preference",
    idempotencyKey: `howyouwork-${at}`,
  });
  yield { type: "text", text: say.reply };
});

test("How you work is a talk: three questions one at a time, each answer a fact in memory, the Vyre knows list, an edit, and the step done", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") {
    t.skip(env);
    return;
  }
  const s = await bootScreens({ kind: "personal", engineOpenSession: model }, env);
  try {
    const owner = s.world.owner;
    const call = createCapCaller({ baseUrl: s.world.d.url, token: () => owner.token }) as unknown as CapCall;
    // an AI account of the person's own, and the first step marked done, so the screen opens on How you work
    await saveApiKey(call, "anthropic", KEY, "howyouwork-key");
    await markStep(call, "personal", "ai", "done");
    const me = await seat(s, owner, "Owner");
    await me.page.goto(`${s.web.origin}/chat`, { waitUntil: "load" });
    const lock = me.page.getByTestId("lock-password");
    if (
      await lock.waitFor({ timeout: 6_000 }).then(
        () => true,
        () => false,
      )
    ) {
      await lock.fill("stand-in");
      await lock.press("Enter");
    }
    // what opens by itself is the one-card Connect your AI; Not now leaves it, and the setup row on the landing opens the steps
    await me.page.getByTestId("first-entry-card").waitFor({ timeout: 40_000 });
    await me.page.getByTestId("onboarding-close").click();
    await me.page.locator('[data-testid^="landing-setup-"]').first().waitFor({ timeout: 30_000 });
    await me.page.locator('[data-testid^="landing-setup-"]').first().click();
    await me.page.getByTestId("onboarding").waitFor({ timeout: 40_000 });
    // the step is How you work, the Assistant's own line asks the first question, and the list has nothing yet
    await me.page.getByTestId("interview-knows").waitFor({ timeout: 20_000 });
    assert.equal(
      await me.page.getByTestId("interview-card").count(),
      0,
      "the card's own form is not drawn beside the talk",
    );
    await me.page.getByTestId("step-ask-prompt").waitFor({ timeout: 20_000 });
    assert.equal((await me.page.getByTestId("step-ask-prompt").innerText()).trim(), "What do you do?");
    assert.equal((await me.page.getByTestId("knows-text-work").innerText()).trim(), "Not yet");
    assert.equal(await me.page.getByTestId("step-next").isDisabled(), true, "Continue waits for the three answers");
    await shoot(me.page, OUT, "start");

    const talk = me.page.getByTestId("onboarding-live");
    const answer = async (text: string): Promise<void> => {
      const field = talk.getByTestId("composer-field");
      await field.waitFor({ timeout: 20_000 });
      await field.click();
      await field.fill(text);
      await talk.getByTestId("composer-send").click();
    };
    const facts = async (): Promise<Fact[]> =>
      ((await call("memory.facts.list", { layer: "person", status: ["current"] })) as { facts: Fact[] }).facts;
    const until = async (why: string, ok: () => Promise<boolean>): Promise<void> => {
      const end = Date.now() + 30_000;
      while (!(await ok())) {
        assert.ok(Date.now() < end, `never happened: ${why}`);
        await me.page.waitForTimeout(250);
      }
    };

    // question 1: the person taps a pick, the pick lands in the composer, they send it
    await me.page.getByTestId("step-ask-0").click();
    assert.ok((await talk.getByTestId("composer-field").innerText()).trim().length > 0, "a pick fills the composer");
    await answer("planner");
    await until("the first fact", async () => (await facts()).some((f) => f.text === "Works as: planner"));
    await me.page
      .getByText(/Which tools do you use every day/)
      .first()
      .waitFor({ timeout: 20_000 });
    await until(
      "the list shows the first line",
      async () => (await me.page.getByTestId("knows-text-work").innerText()).trim() === "planner",
    );
    assert.equal(
      (await me.page.getByTestId("step-ask-prompt").innerText()).trim(),
      "Which tools do you use every day?",
    );
    assert.equal(turn, 1, "one question, one turn");
    await shoot(me.page, OUT, "first-answer");

    // question 2
    await answer("Gmail, Sheets");
    await until("the second fact", async () => (await facts()).some((f) => f.text === "Uses every day: Gmail, Sheets"));
    await me.page
      .getByText(/short, or in detail/)
      .first()
      .waitFor({ timeout: 20_000 });
    assert.equal(turn, 2);

    // question 3
    await answer("Short and to the point");
    await until("the third fact", async () =>
      (await facts()).some((f) => f.text === "Prefers answers that are: Short and to the point"),
    );
    await me.page
      .getByText(/Saved: planner/)
      .first()
      .waitFor({ timeout: 20_000 });
    assert.equal(turn, 3, "three answers, three turns, never a fourth question");
    assert.ok(
      seen.every((x) => x.instructed),
      "every turn carried the step's instructions to the model",
    );
    const mine = (await facts()).filter((f) => /^(Works as|Uses every day|Prefers answers that are): /.test(f.text));
    assert.equal(mine.length, 3);
    assert.ok(
      mine.every((f) => f.sourceKind === "manual" && f.sourceRef === "onboarding"),
      JSON.stringify(mine),
    );

    // the list shows the three lines and the step is done: Continue is open
    await until(
      "the third line is listed",
      async () => (await me.page.getByTestId("knows-text-style").innerText()).trim() === "Short and to the point",
    );
    assert.equal((await me.page.getByTestId("knows-text-tools").innerText()).trim(), "Gmail, Sheets");
    await until("Continue opens", async () => !(await me.page.getByTestId("step-next").isDisabled()));
    await until(
      "the step is marked done",
      async () => (await loadFlow(call, "personal")).progress["interview"] === "done",
    );
    await shoot(me.page, OUT, "done");

    // an edit of one line is saved in place
    await me.page.getByTestId("knows-change-work").click();
    const edit = me.page.getByTestId("knows-edit-work");
    await edit.fill("operations lead");
    await me.page.getByTestId("knows-save-work").click();
    await until("the edited fact", async () => (await facts()).some((f) => f.text === "Works as: operations lead"));
    assert.ok(
      !(await facts()).some((f) => f.text === "Works as: planner"),
      "the old words are not left beside the new",
    );
    await until(
      "the list shows the edit",
      async () => (await me.page.getByTestId("knows-text-work").innerText()).trim() === "operations lead",
    );
    await shoot(me.page, OUT, "edited");

    // a line is removed in place
    await me.page.getByTestId("knows-remove-tools").click();
    await until("the fact is gone", async () => !(await facts()).some((f) => f.text.startsWith("Uses every day")));
    await until(
      "the line says Not yet",
      async () => (await me.page.getByTestId("knows-text-tools").innerText()).trim() === "Not yet",
    );
    assert.deepEqual(me.errors, [], "no page errors");
  } catch (e) {
    await s.debug(OUT);
    const pg = s.seats[0]?.page;
    if (pg)
      console.error(
        `PAGE: ${(
          (await pg
            .locator("body")
            .innerText()
            .catch(() => "")) as string
        )
          .replace(/\s+/g, " ")
          .slice(0, 600)} | ${s.seats[0]!.logs.slice(-5).join("; ")}`,
      );
    throw e;
  } finally {
    await s.close();
  }
});
