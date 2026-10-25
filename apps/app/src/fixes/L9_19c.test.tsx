// P-L9_19c: the shell's Home place draws the real Home body (greeting, Needs you with action buttons, My work, Quick start and the Ask box), not the sample rows.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { SamplePlace } from "../shell/spaces/sample.tsx";
import { homePlace, homeVariantOf } from "../shell/spaces/sample-home.tsx";
import { StyleSheet } from "react-native";
import { createSampleHome, northwind as northwindHome } from "../places/home/sections-a/sample.ts";
import { ASK_DOCK } from "../places/home/sections-b/AskBox.tsx";
import { statusIcon } from "../places/home/sections-a/model.ts";
import { Plan } from "../../../../ui/src/Plan/index.tsx";
import { createTask } from "../places/home/sections-a/actions.ts";
import { planEdits, planStatus, planTasks, stateOf } from "../places/home/sections-a/plan.ts";
import { StatusCircle } from "../places/home/sections-a/parts.tsx";
import type { PlaceContext } from "../shell/spaces/Shell.tsx";
import { kitById } from "../shell/rail/kits.ts";

const ctx = (spaceId: string, place: PlaceContext["place"]): PlaceContext => ({ spaceId, spaceName: spaceId, kind: spaceId === "me" ? "personal" : "team", place, hash: "", epoch: 1, kit: kitById("northwind") });
const html = (spaceId: string, place: PlaceContext["place"] = "home"): string => renderToStaticMarkup(<>{homePlace(ctx(spaceId, place))}</>).replaceAll("<!-- -->", "");
const at = (s: string, needle: string): number => { const i = s.indexOf(needle); assert.ok(i >= 0, `expected ${needle}`); return i; };

test("a shell Space id maps to its sample Home", () => {
  assert.equal(homeVariantOf("nw"), "northwind");
  assert.equal(homeVariantOf("hb"), "harbor");
  assert.equal(homeVariantOf("me"), "personal");
});

test("Northwind Home is the real page: greeting, Needs you, My work, then Quick start and the Ask box last", () => {
  const out = html("nw");
  assert.ok(out.includes('data-testid="home-place"'), "the Home place, not the sample list");
  assert.ok(!out.includes('data-testid="sample-home"'), "no router placeholder");
  assert.match(out, /Good (morning|afternoon|evening), Irfad/);
  const order = ["s-needs", "s-work", "s-ask"].map((id) => at(out, `data-testid="${id}"`));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(at(out, "Quick start") > at(out, 'data-testid="s-work"'));
  assert.ok(out.includes("Ask your assistant"));
});

test("Needs you carries its action buttons", () => {
  const out = html("nw");
  assert.ok(out.slice(at(out, 'data-testid="s-needs"'), at(out, 'data-testid="s-work"')).includes('data-testid="need-action-'), "an action button sits in Needs you");
});

test("Harbor Studio and Personal draw their own Home", () => {
  const harbor = html("hb");
  const personal = html("me");
  assert.ok(harbor.includes('data-testid="home-place"') && personal.includes('data-testid="home-place"'));
  assert.notEqual(harbor, personal);
});

test("every other place keeps its sample rows", () => {
  for (const place of ["chats", "inbox", "records", "files"] as const) {
    const el = homePlace(ctx("nw", place)) as ReactElement<{ ctx: PlaceContext }>;
    assert.equal(el.type, SamplePlace, place);
    assert.equal(el.props.ctx.place, place);
  }
});

test("My work carries the List | Plan toggle, the review mark and the project label as the prototype", () => {
  const out = html("nw");
  assert.ok(out.includes('data-testid="work-view-list"') && out.includes('data-testid="work-view-plan"'), "the layout toggle");
  assert.ok(out.includes('aria-checked="true"'), "one layout is on");
  assert.equal(createSampleHome(northwindHome).data.recordTitle("rec_atp1"), "ATP · Harlow & Price", "the project label is the whole name");
  assert.equal(statusIcon({ state: "todo", blocked: false, kind: "review" }), "review");
  assert.equal(statusIcon({ state: "todo", blocked: false, kind: "approve" }), "review");
  assert.equal(statusIcon({ state: "todo", blocked: false, kind: "work" }), "todo");
});

test("Quick start and the Ask composer are the last section, docked", () => {
  const out = html("nw");
  assert.ok(at(out, 'data-testid="s-ask"') > at(out, 'data-testid="s-work"'));
  const dock = StyleSheet.flatten(ASK_DOCK) as Record<string, unknown>;
  assert.equal(dock["position"], "sticky", "sticks to the foot of the place");
  assert.equal(dock["bottom"], 0);
});

test("the Ask box is the shared composer: the Ask agent pill beside it, only + @ # in the tool row, no who-will-answer line", () => {
  const out = html("nw");
  assert.ok(out.includes('data-testid="ask-agent"'), "the shared AskButton beside the box");
  assert.ok(!out.includes('data-testid="composer-who"') && !out.includes("will reply"), "no answer line");
  assert.ok(out.includes("Attach a file") && out.includes("(@)") && out.includes("(#)"), "+ @ #");
  assert.ok(!out.includes("snippets (/)"), "no slash button");
});

test("a review task wears a ring with a check, not a filled dot", () => {
  const svg = renderToStaticMarkup(<StatusCircle status="review" />);
  assert.ok(svg.includes('data-status="review"') && svg.includes("<path") && svg.split("<circle").length === 2, "one ring and a tick, no inner dot");
});

test("Plan mode: the open tasks are bars ending on their due day and lasting their effort; a task without a due date is left off", () => {
  const home = createSampleHome(northwindHome);
  const ctx = { clock: home.data.clock(), recordTitle: (id: string) => home.data.recordTitle(id), name: (id: string) => id, kindOf: () => "person" };
  const t = (id: string, o: Record<string, unknown>) => ({ id, title: id, kind: "work", state: "todo", blocked: false, dependsOn: [], assigned: { kind: "person", id: "usr_irfad" }, ...o }) as never;
  const list = planTasks([t("a", { due: Date.UTC(2025, 9, 24, 12), effort: 3 }), t("b", { due: Date.UTC(2025, 9, 24, 12) }), t("c", {})], ctx);
  assert.deepEqual(list.map((x) => [x.id, x.start, x.end]), [["a", "2025-10-22", "2025-10-24"], ["b", "2025-10-24", "2025-10-24"]]);
  assert.equal(planStatus({ state: "todo", blocked: false, kind: "review" }), "review");
  assert.equal(planStatus({ state: "todo", blocked: false, kind: "approve" }), "approval");
  assert.equal(planStatus({ state: "doing", blocked: true, kind: "work" }), "blocked");
  assert.equal(stateOf("approval"), "awaiting_approval");
});

test("Plan mode: a bar moved on the timeline becomes a reschedule of that task, a state change a transition, a new face an assignment", () => {
  const home = createSampleHome(northwindHome);
  const ctx = { clock: home.data.clock(), recordTitle: () => undefined, name: (id: string) => id, kindOf: () => "person" };
  const tk = { id: "a", title: "A", kind: "work", state: "todo", blocked: false, dependsOn: [], assigned: { kind: "person", id: "usr_irfad" }, due: Date.UTC(2025, 9, 24, 12), effort: 2 } as never;
  const prev = planTasks([tk], ctx);
  const moved = [{ ...prev[0]!, start: "2025-10-25", end: "2025-10-27", status: "done" as const, assigned: { name: "Maya Chen", kind: "person" as const } }];
  const edits = planEdits(prev, moved, [tk], ctx, [{ id: "usr_maya", name: "Maya Chen", kind: "person" }]);
  assert.deepEqual(edits, [
    { kind: "reschedule", id: "a", due: Date.UTC(2025, 9, 24, 12) + 3 * 86_400_000, effort: 3 },
    { kind: "state", id: "a", to: "done" },
    { kind: "assign", id: "a", to: { kind: "person", id: "usr_maya" } },
  ]);
  assert.deepEqual(planEdits(prev, prev, [tk], ctx, []), []);
});

test("Plan's New task and a stage's + create the task through tasks.create (mine, in that project), and it comes back from the live query, not a local insert", async () => {
  const home = createSampleHome(northwindHome);
  const calls: { cap: string; input: unknown }[] = [];
  const d = { call: async (cap: string, input: unknown) => { calls.push({ cap, input }); return home.data.call(cap, input); }, note: () => undefined, me: "usr_irfad", nameOf: (id: string) => id };
  const before = (home.replica.rows("tasks") as unknown[]).length;
  assert.equal(await createTask(d as never, "New task", { recordId: "rec_atp1", due: Date.UTC(2025, 9, 26), effort: 3 }), true);
  assert.deepEqual(calls.map((c) => c.cap), ["tasks.create"]);
  const input = calls[0]!.input as Record<string, unknown>;
  assert.deepEqual([input["title"], input["recordId"], input["assigned"], input["effort"]], ["New task", "rec_atp1", { kind: "person", id: "usr_irfad" }, 3]);
  assert.equal((home.replica.rows("tasks") as unknown[]).length, before + 1, "the replica has the new task");
  assert.equal(await createTask(d as never, "New task"), true);
  assert.equal("recordId" in (calls[1]!.input as object), false, "Personal: no project");
});

test("the Plan with onCreate asks the host and inserts nothing itself", () => {
  const html = renderToStaticMarkup(<Plan today="2025-10-24" stages={[{ id: "s", name: "S" }]} tasks={[]} onCreate={() => undefined} />);
  assert.ok(html.includes('data-testid="plan-add"'));
});
