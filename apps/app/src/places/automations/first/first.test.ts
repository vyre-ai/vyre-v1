import test from "node:test";
import assert from "node:assert/strict";
import { firstPage, type NeedIn, type SuggestionIn } from "./model.ts";

const need = (o: Partial<NeedIn> & { id: string }): NeedIn => ({
  automation: "New lead follow-up",
  why: "Step 2, Text to me, could not run: the Twilio key is missing.",
  at: 1000,
  fix: { label: "Add the key", kind: "key" },
  ...o,
});
const sugg = (o: Partial<SuggestionIn> & { id: string }): SuggestionIn => ({
  app: { id: "notely", name: "Notely" },
  item: "Notely API key",
  mayUse: true,
  knownService: true,
  assistant: "cleared",
  ...o,
});

test("Needs you cards come newest first, each with its one fix, and the same thing is never listed twice", () => {
  const page = firstPage({
    needs: [
      need({ id: "a", at: 100 }),
      need({
        id: "b",
        at: 300,
        automation: "Invoice reminders",
        why: "Waiting for you to approve 4 invoices.",
        fix: { label: "Approve all 4", kind: "approve" },
      }),
      need({ id: "a2", at: 200 }),
    ],
    suggestions: [],
    today: { ran: 4, failed: [] },
  });
  assert.deepEqual(
    page.needs.map((n) => [n.id, n.fix.label]),
    [
      ["b", "Approve all 4"],
      ["a2", "Add the key"],
    ],
  );
});

test("at most one suggestion, and only one the person can finish with a single approval", () => {
  const cases: [string, Partial<SuggestionIn>, "shown" | "hidden"][] = [
    ["cleared Assistant", {}, "shown"],
    ["Assistant needs the owner's one approval", { assistant: "owner" }, "shown"],
    ["clearing needs an admin (Google DWD, a Restricted item)", { assistant: "admin" }, "hidden"],
    ["view only", { mayUse: false }, "hidden"],
    ["no known service", { knownService: false }, "hidden"],
    ["dismissed with Not now", { dismissed: true }, "hidden"],
  ];
  for (const [name, patch, want] of cases) {
    const page = firstPage({ needs: [], suggestions: [sugg({ id: "s", ...patch })], today: { ran: 0, failed: [] } });
    assert.equal(page.suggestion ? "shown" : "hidden", want, name);
  }
  const two = firstPage({
    needs: [],
    suggestions: [
      sugg({ id: "dwd", assistant: "admin" }),
      sugg({ id: "n" }),
      sugg({ id: "m", app: { id: "mail", name: "Mailo" } }),
    ],
    today: { ran: 0, failed: [] },
  });
  assert.equal(two.suggestion?.id, "n");
});

test("the suggestion says what it connects and whether one tap is needed", () => {
  const cleared = firstPage({ needs: [], suggestions: [sugg({ id: "s" })], today: { ran: 0, failed: [] } }).suggestion!;
  assert.deepEqual(
    [cleared.title, cleared.quiet, cleared.action, cleared.dismiss, cleared.approval],
    ["Connect Notely", "Notely API key", "Set up", "Not now", "none"],
  );
  const owner = firstPage({
    needs: [],
    suggestions: [sugg({ id: "s", assistant: "owner" })],
    today: { ran: 0, failed: [] },
  }).suggestion!;
  assert.equal(owner.approval, "allow");
});

test("the Today line", () => {
  const line = (ran: number, failed: string[], needs: NeedIn[]) => {
    const p = firstPage({ needs, suggestions: [], today: { ran, failed: failed.map((runId) => ({ runId })) } });
    return [p.today.parts.map((x) => x.v).join(""), p.today.failedRunId ?? null];
  };
  assert.deepEqual(line(4, ["r4"], [need({ id: "a" })]), ["4 ran, 1 failed. The rest is on track.", "r4"]);
  assert.deepEqual(line(4, [], []), ["4 ran. Everything is on track.", null]);
  assert.deepEqual(line(0, [], []), ["Nothing ran today.", null]);
  assert.deepEqual(line(5, ["x", "y"], [need({ id: "a" })]), ["5 ran, 2 failed. The rest is on track.", "x"]);
});

test("the page carries no line that explains the interface", () => {
  const p = firstPage({ needs: [need({ id: "a" })], suggestions: [sugg({ id: "s" })], today: { ran: 1, failed: [] } });
  assert.deepEqual(Object.keys(p).sort(), ["needs", "suggestion", "today"]);
});
