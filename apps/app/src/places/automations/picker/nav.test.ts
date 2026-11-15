import test from "node:test";
import assert from "node:assert/strict";
import { pickerRows, type PickApp, type PickStep } from "./model.ts";
import { INITIAL, mainRows, step, type Nav } from "./nav.ts";

const STEPS: PickStep[] = [
  { key: "create_task", title: "Create a task" },
  { key: "send_email", title: "Send an email" },
  { key: "sign", title: "Send for signature" },
  { key: "google.gmail.send_message", title: "Send a Gmail message" },
  { key: "google.sheets.append_values", title: "Add a row to a sheet" },
];
const APPS: PickApp[] = [{ id: "google", name: "Google Workspace", connected: true, mayUse: true }];
const model = { steps: STEPS, apps: APPS, suggested: ["send_email"] };

const run = (keys: string[], from: Nav = INITIAL) => {
  let s = from;
  let last: ReturnType<typeof step>["effect"] = null;
  for (const k of keys) {
    const r = step(model, s, k.startsWith("type:") ? { type: k.slice(5) } : { key: k });
    s = r.state;
    last = r.effect;
  }
  return { s, last };
};
const at = (s: Nav) => mainRows(model, s)[s.index]!;

test("the list opens on its first row; arrows move through the rows, skipping headings, and wrap", () => {
  const rows = mainRows(model, INITIAL);
  assert.deepEqual(
    rows.map((r) => r.kind),
    ["step", "group", "group", "group", "app", "connect"],
  );
  assert.equal(at(INITIAL).kind, "step");
  assert.equal(at(run(["ArrowDown"]).s).kind, "group");
  assert.equal(at(run(["ArrowUp"]).s).kind, "connect");
  assert.equal(at(run(["ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown"]).s).kind, "step");
});

test("Right opens a group or app and moves into its actions; arrows work inside; Enter adds; Left steps back", () => {
  const toApp = ["ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown"]; // step, Messages, Documents and signing, Decide? (see rows)
  const s0 = run(toApp).s;
  assert.equal(at(s0).kind, "app");
  const inApp = run(["ArrowRight"], s0);
  assert.deepEqual([inApp.s.col, inApp.s.open], ["sub", "app:google"]);
  assert.equal(inApp.last, null);
  const down = run(["ArrowDown"], inApp.s);
  assert.equal(down.s.subIndex, 1);
  const choose = run(["Enter"], down.s);
  assert.deepEqual(choose.last, { kind: "choose", stepId: "google.sheets.append_values" });
  const back = run(["ArrowLeft"], down.s);
  assert.deepEqual([back.s.col, back.s.open], ["main", null]);
  assert.equal(at(back.s).kind, "app");
});

test("Enter on a step adds it, on a group or app opens it, on Connect an app opens the sheet", () => {
  assert.deepEqual(run(["Enter"]).last, { kind: "choose", stepId: "send_email" });
  const open = run(["ArrowDown", "Enter"]);
  assert.equal(open.s.col, "sub");
  assert.equal(open.last, null);
  assert.deepEqual(run(["ArrowUp", "Enter"]).last, { kind: "connect" });
});

test("Escape steps back one level: out of the actions, then clears the search, then closes", () => {
  const inGroup = run(["ArrowDown", "ArrowRight"]);
  assert.equal(inGroup.s.col, "sub");
  const out = run(["Escape"], inGroup.s);
  assert.deepEqual([out.s.col, out.last], ["main", null]);
  const typed = run(["type:sign"]);
  assert.equal(typed.s.query, "sign");
  const cleared = run(["Escape"], typed.s);
  assert.deepEqual([cleared.s.query, cleared.last], ["", null]);
  assert.deepEqual(run(["Escape"]).last, { kind: "close" });
});

test("typing filters across everything, lights the first match, and Enter adds it; Right does nothing in a search", () => {
  const typed = run(["type:sign"]);
  assert.equal(at(typed.s).kind, "step");
  assert.deepEqual(run(["Enter"], typed.s).last, { kind: "choose", stepId: "sign" });
  assert.equal(run(["ArrowRight"], typed.s).s.col, "main");
  const none = run(["type:zzzz"]);
  assert.equal(at(none.s).kind, "connect");
  assert.deepEqual(run(["Enter"], none.s).last, { kind: "connect" });
});

test("pointing at a group or app row opens its actions beside the list without moving the keyboard into them", () => {
  const r = step(model, INITIAL, { hover: "app:google" });
  assert.deepEqual([r.state.open, r.state.col], ["app:google", "main"]);
  assert.equal(
    r.state.index,
    mainRows(model, INITIAL).findIndex((x) => x.kind === "app"),
  );
  assert.equal(
    pickerRows(model, "").some((x) => x.kind === "app"),
    true,
  );
});
