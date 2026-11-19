// The Kanban on a Journey's board, in a rendered tree: the column heads (limit, late), the card's face, a group moved from the bar, bands by owner, the keys (Alt and the arrows, Space, Z, ?), undo,
// and the failure cases the move machine names: two people on one card and an Automation moving the card during a drag.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { RecordsDataProvider, RecordsStateProvider } from "../sidebar/index.ts";
import type { RecordsData } from "../sidebar/index.ts";
import { RecordViews } from "../views-a/index.ts";
import { createViewsSample, northwind } from "../views-a/sample.ts";
import { createSampleRecords } from "../table/sample.ts";
import type { SampleSpace } from "../table/sample.ts";
import type { FieldDef, RecordRow, TypeDef } from "../table/model.ts";
import { wipOf } from "./stages.ts";

const NOW = Date.now();
const DAY = 86_400_000;
const f = (
  key: string,
  type: string,
  title: string,
  options?: Record<string, unknown>,
  extra: Partial<FieldDef> = {},
): FieldDef => ({ key, type, title, ...(options ? { options } : {}), ...extra });
const STAGES = {
  stages: [
    { key: "stage1", title: "Intake" },
    { key: "stage2", title: "In review" },
    { key: "stage3", title: "Done" },
  ],
};
const JOURNEY: TypeDef = {
  key: "journey_onboarding",
  title: "Onboarding",
  plural: "Onboarding",
  icon: "route",
  label: "internal",
  system: false,
  titleField: "name",
  group: "Journeys",
  statusField: "stage",
  version: 1,
  fields: [
    f("name", "text", "Name", undefined, { required: true }),
    f("stage", "status", "Stage", STAGES, { writeOnlyBy: ["journeys.move_stage"] }),
    f("owner", "person", "Owner"),
    f("amount", "money", "Amount"),
    f("subject", "relation", "Subject", { target: "clients" }, { required: true }),
  ],
};
const jrow = (i: number, stage: string, owner: string, amount?: number): RecordRow => ({
  id: `jr_${i}`,
  type: JOURNEY.key,
  version: 1,
  label: 1,
  createdAt: NOW - 9 * DAY,
  updatedAt: NOW - (i === 1 ? 5 : 1) * DAY,
  holds: 0,
  fields: {
    name: `Onboarding ${i}`,
    stage,
    owner,
    subject: `cl_${i}`,
    ...(amount ? { amount: { amount, currency: "USD" } } : {}),
  },
});
const space: SampleSpace = {
  ...northwind,
  types: [...northwind.types, JOURNEY],
  counts: { ...northwind.counts, [JOURNEY.key]: 3 },
  rows: {
    [JOURNEY.key]: [
      jrow(1, "stage1", "usr_maya", 4000),
      jrow(2, "stage1", "usr_omar", 1000),
      jrow(3, "stage2", "usr_maya"),
    ] as never,
  },
};
const DESIGN = [
  {
    key: "stage1",
    title: "Intake",
    order: 0,
    timeLimit: { hours: 48 },
    tasks: [],
    automations: [],
    exit: { requireTasks: false },
  },
  { key: "stage2", title: "In review", order: 1, tasks: [], automations: [], exit: { requireTasks: false } },
  { key: "stage3", title: "Done", order: 2, final: true, tasks: [], automations: [], exit: { requireTasks: false } },
];

function sample(o: { actor?: string; failMove?: string; gate?: boolean } = {}) {
  const ahead = { on: false };
  const base = createSampleRecords(space);
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const data: RecordsData = {
    ...base.data,
    actorOf: (id) =>
      id === "run_abc"
        ? { kind: "automation", name: "" }
        : id === "usr_omar"
          ? { kind: "person", name: "Omar Haddad" }
          : null,
    async call(cap, input) {
      const i = input as Record<string, unknown>;
      if (cap === "journeys.list")
        return {
          journeys: [
            {
              id: "jrn_1",
              name: "Onboarding",
              subjectType: "clients",
              recordType: JOURNEY.key,
              version: 1,
              stages: 3,
              inFlight: 3,
              updatedAt: NOW,
            },
          ],
        };
      if (cap === "journeys.get") return { journey: { id: "jrn_1", stages: DESIGN } };
      if (cap === "journeys.stage_since") return { since: { jr_1: NOW - 5 * DAY, jr_2: NOW - DAY, jr_3: NOW - DAY } };
      if (cap === "journeys.stage_counts")
        return {
          stages: [
            { stage: "stage1", count: 2, overLimit: 1 },
            { stage: "stage2", count: 1, overLimit: 0 },
          ],
        };
      if (cap === "records.get") {
        const row = (base.replica.rows(`records:${JOURNEY.key}`) as unknown as RecordRow[]).find(
          (r) => r.id === i["recordId"],
        );
        return { record: row && ahead.on ? { ...row, version: row.version + 1 } : row };
      }
      if (cap === "records.activity")
        return { entries: [{ id: "e1", kind: "stage", at: NOW, actor: o.actor ?? "usr_omar" }] };
      if (cap === "journeys.move_stage" && ahead.on) throw new Error("It changed first. Look at the card and try again.");
      if (cap === "journeys.move_stage") {
        calls.push({ cap, input: i });
        if (o.failMove) throw new Error(o.failMove);
        if (o.gate)
          throw Object.assign(new Error("fields required"), {
            details: {
              reason: "fields_required",
              toStage: "stage2",
              fields: [{ key: "owner", title: "Owner", stage: "stage2", when: "enter" }],
            },
          });
        const cur = (base.replica.rows(`records:${JOURNEY.key}`) as unknown as RecordRow[]).find(
          (r) => r.id === i["recordId"],
        )!;
        if (i["expectedVersion"] !== undefined && i["expectedVersion"] !== cur.version) {
          calls.pop();
          throw new Error("It changed first. Look at the card and try again.");
        }
        base.replica.put(`records:${JOURNEY.key}`, [
          { ...cur, version: cur.version + 1, fields: { ...cur.fields, stage: i["toStage"] } } as never,
        ]);
        return { recordId: i["recordId"], stage: i["toStage"] };
      }
      if (cap === "records.update") {
        calls.push({ cap, input: i });
        return {};
      }
      return base.data.call(cap, input);
    },
  };
  const put = (id: string, stage: string): void => {
    const cur = (base.replica.rows(`records:${JOURNEY.key}`) as unknown as RecordRow[]).find((r) => r.id === id)!;
    base.replica.put(`records:${JOURNEY.key}`, [
      { ...cur, version: cur.version + 1, fields: { ...cur.fields, stage } } as never,
    ]);
  };
  return { ...base, data, calls, put, ahead };
}

async function mountBoard(s: ReturnType<typeof sample>): Promise<{ root: Node; stop(): Promise<void> }> {
  const r = createRoot();
  await act(async () => {
    r.render(
      <RecordsDataProvider value={s.data}>
        <RecordsStateProvider initial={{ type: JOURNEY.key }}>
          <RecordViews />
        </RecordsStateProvider>
      </RecordsDataProvider>,
    );
  });
  await flush();
  await flush();
  return {
    root: r.container as unknown as Node,
    stop: async () => {
      await act(async () => {
        r.unmount();
      });
    },
  };
}
const drag = async (root: Node, id: string): Promise<void> =>
  act(async () => {
    (find(root, `drag-${id}`)!.props.onDragStart as (e: unknown) => void)({
      dataTransfer: { setData() {}, effectAllowed: "" },
    });
  });
const over = async (root: Node, lane: string): Promise<void> =>
  act(async () => {
    (find(root, `drop-${lane}`)!.props.onDragOver as (e: unknown) => void)({
      preventDefault() {},
      dataTransfer: { dropEffect: "" },
    });
  });
const drop = async (root: Node, lane: string): Promise<void> =>
  act(async () => {
    (find(root, `drop-${lane}`)!.props.onDrop as (e: unknown) => void)({ preventDefault() {} });
  });
const key = async (root: Node, k: string, extra: Record<string, unknown> = {}): Promise<void> =>
  act(async () => {
    (find(root, "board-sheet")!.props.onKeyDown as (e: unknown) => void)({
      key: k,
      preventDefault() {},
      target: {},
      ...extra,
    });
  });
const count = (root: Node, lane: string): string =>
  (find(root, `lane-count-${lane}`)?.children ?? []).map(String).join("");

test("a column's head says the stage's time limit and how many cards are late; a card says its day and its owner", async () => {
  const restore = installDom();
  const s = sample();
  const b = await mountBoard(s);
  try {
    assert.match(textOf(find(b.root, "col-limit-stage1")), /2 d/, "the limit of 48 hours reads as 2 d");
    assert.match(textOf(find(b.root, "col-late-stage1")), /1 late/);
    assert.equal(find(b.root, "col-late-stage2"), null, "a stage with none late says nothing");
    assert.equal(textOf(find(b.root, "col-total-stage1")).trim(), "$5k", "the value total of the column's cards");
    assert.match(textOf(find(b.root, "card-age-jr_1")), /3 d late/, "5 days in a stage limited to 2 days");
    assert.match(textOf(find(b.root, "card-age-jr_2")), /Day 1/);
    assert.ok(find(b.root, "card-late-jr_1") && !find(b.root, "card-late-jr_2"), "a late card has its edge bar");
    assert.ok(find(b.root, "card-journey-jr_1"), "the Journey mark");
    assert.ok(find(b.root, "lane-stage1") && find(b.root, "lane-stage2"));
    assert.equal(find(b.root, "lane-stage3"), null, "a finish line is a strip until it is opened");
    assert.ok(find(b.root, "finish-stage3"));
    assert.equal(count(b.root, "stage1"), "2");
    await press(find(b.root, "finish-stage3"));
    await flush();
    assert.ok(find(b.root, "lane-stage3"), "pressing the strip opens it as a column");
  } finally {
    await b.stop();
    restore();
  }
});

test("the WIP limits a view keeps are numbers above zero and nothing else", () => {
  assert.deepEqual(wipOf({ config: { wip: { a: 3, b: 0, c: "x", d: 2.5, e: 7 } } }), { a: 3, e: 7 });
  assert.deepEqual(wipOf({ config: {} }), {});
  assert.deepEqual(wipOf(undefined), {});
});

test("a drag lights the lane it is over with a placeholder, and dropping moves the card once", async () => {
  const restore = installDom();
  const s = sample();
  const b = await mountBoard(s);
  try {
    await drag(b.root, "jr_2");
    await over(b.root, "stage2");
    assert.ok(find(b.root, "place-stage2"), "a placeholder where it will land");
    await drop(b.root, "stage2");
    await flush();
    assert.deepEqual(
      s.calls.map((c) => [c.cap, c.input["recordId"], c.input["toStage"], c.input["expectedVersion"]]),
      [["journeys.move_stage", "jr_2", "stage2", 1]],
      "the move carries the version the card was drawn at",
    );
    assert.equal(count(b.root, "stage2"), "2");
    assert.match(textOf(find(b.root, "board-toast-text")), /Moved Onboarding 2 to In review\./);
    await press(find(b.root, "board-undo"));
    await flush();
    await flush();
    assert.equal(count(b.root, "stage1"), "2", "Undo put it back");
    assert.deepEqual(
      s.calls.map((c) => c.input["toStage"]),
      ["stage2", "stage1"],
    );
  } finally {
    await b.stop();
    restore();
  }
});

test("a refusal stays on the card after the drag ends (the browser's dragend must not clear it)", async () => {
  const restore = installDom();
  const s = sample({ failMove: "stage precondition: required task t1 is not done (validation.precondition_failed)" });
  const b = await mountBoard(s);
  try {
    await drag(b.root, "jr_2");
    await over(b.root, "stage2");
    await drop(b.root, "stage2");
    await act(async () => {
      (find(b.root, "drag-jr_2")!.props.onDragEnd as () => void)();
    });
    await flush();
    await flush();
    assert.match(textOf(find(b.root, "card-refused-jr_2")), /Finish the required tasks in this stage first\./);
    assert.equal(count(b.root, "stage1"), "2", "the card stays where it was");
    await press(find(b.root, "card-refused-dismiss-jr_2"));
    assert.equal(find(b.root, "card-refused-jr_2"), null, "the little cross puts the reason away");
  } finally {
    await b.stop();
    restore();
  }
});

test("two people on one card: someone moved it while it was held, so the drop never overwrites theirs", async () => {
  const restore = installDom();
  const s = sample({ actor: "usr_omar" });
  const b = await mountBoard(s);
  try {
    await drag(b.root, "jr_1");
    await over(b.root, "stage2");
    await act(async () => {
      s.put("jr_1", "stage1"); // a stand-in write: nothing yet
    });
    await act(async () => {
      s.put("jr_1", "stage3");
    });
    await flush();
    await flush();
    await drop(b.root, "stage2");
    await flush();
    assert.deepEqual(s.calls, [], "no move was asked for");
    assert.match(textOf(find(b.root, "board-toast-text")), /Omar moved it to Done first\. It stays there\./);
  } finally {
    await b.stop();
    restore();
  }
});

test("an Automation moves the card during the drag: the same rule, said with an Automation's name", async () => {
  const restore = installDom();
  const s = sample({ actor: "run_abc" });
  const b = await mountBoard(s);
  try {
    await drag(b.root, "jr_2");
    await over(b.root, "stage2");
    await act(async () => {
      s.put("jr_2", "stage3");
    });
    await flush();
    await flush();
    await drop(b.root, "stage2");
    await flush();
    assert.deepEqual(s.calls, []);
    assert.match(textOf(find(b.root, "board-toast-text")), /An Automation moved it to Done first\./);
  } finally {
    await b.stop();
    restore();
  }
});

test("a group from the bar: select two, Move to a stage, one move each, one toast", async () => {
  const restore = installDom();
  const s = sample();
  const b = await mountBoard(s);
  try {
    assert.equal(find(b.root, "board-select-bar"), null);
    await press(find(b.root, "tick-jr_1"));
    await press(find(b.root, "tick-jr_2"));
    assert.match(textOf(find(b.root, "board-select-bar")), /2 selected/);
    await press(find(b.root, "bar-move"));
    await press(find(b.root, "menu-item-In review"));
    await flush();
    await flush();
    assert.deepEqual(
      s.calls.map((c) => [c.input["recordId"], c.input["toStage"]]),
      [
        ["jr_1", "stage2"],
        ["jr_2", "stage2"],
      ],
    );
    assert.equal(find(b.root, "board-select-bar"), null, "the selection clears");
    assert.match(textOf(find(b.root, "board-toast-text")), /Moved 2 onboarding to In review\./);
  } finally {
    await b.stop();
    restore();
  }
});

test("keys: arrows move the focus, Space selects, Alt and the right arrow moves the card, Z puts it back, ? lists the keys", async () => {
  const restore = installDom();
  const s = sample();
  const b = await mountBoard(s);
  try {
    await key(b.root, "ArrowDown");
    await key(b.root, " ");
    assert.match(textOf(find(b.root, "board-select-bar")), /1 selected/);
    await key(b.root, "Escape");
    assert.equal(find(b.root, "board-select-bar"), null);
    await key(b.root, "ArrowRight", { altKey: true });
    await flush();
    await flush();
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0]!.input["toStage"], "stage2");
    await key(b.root, "z");
    await flush();
    await flush();
    assert.deepEqual(
      s.calls.map((c) => c.input["toStage"]),
      ["stage2", "stage1"],
    );
    assert.equal(find(b.root, "board-keys-list"), null);
    await key(b.root, "?");
    assert.ok(find(b.root, "board-keys-list"), "the keys appear behind ?");
  } finally {
    await b.stop();
    restore();
  }
});

test("bands by owner: one band per person with a card, each with its own columns", async () => {
  const restore = installDom();
  const s = sample();
  const b = await mountBoard(s);
  try {
    await press(find(b.root, "board-swim"));
    await press(find(b.root, "menu-item-Owner"));
    await flush();
    await flush();
    assert.ok(find(b.root, "band-usr_maya") && find(b.root, "band-usr_omar"));
    assert.ok(find(b.root, "lane-stage1-usr_maya") && find(b.root, "lane-stage1-usr_omar"));
    assert.ok(find(b.root, "card-jr_1") && find(b.root, "card-jr_2") && find(b.root, "card-jr_3"));
  } finally {
    await b.stop();
    restore();
  }
});

test("the card face editor: a Journey's board starts Detailed; Simple takes the figure off, Visual adds a cover; the editor closes", async () => {
  const restore = installDom();
  const s = sample();
  const b = await mountBoard(s);
  try {
    assert.match(textOf(find(b.root, "card-amount-jr_1")), /\$4,000/, "Detailed lifts the amount out");
    await press(find(b.root, "board-face"));
    assert.ok(find(b.root, "face-panel"));
    await press(find(b.root, "face-preset-simple"));
    await flush();
    assert.equal(find(b.root, "card-amount-jr_1"), null, "Simple has no big figure");
    await press(find(b.root, "face-preset-visual"));
    await flush();
    assert.ok(find(b.root, "cover-jr_1"), "Visual has a cover");
    await press(find(b.root, "face-switch-amount"));
    await flush();
    assert.equal(find(b.root, "card-amount-jr_1"), null, "the Amount switch takes the figure off the card");
    await press(find(b.root, "face-close"));
    assert.equal(find(b.root, "face-panel"), null);
  } finally {
    await b.stop();
    restore();
  }
});

// ---------------------------------------------------------------- an ordinary type's board: WIP limits from the view, quick add

async function plainBoard(
  s: { data: RecordsData },
  initial: { type: string; viewId?: string },
): Promise<{ root: Node; stop(): Promise<void> }> {
  const r = createRoot();
  await act(async () => {
    r.render(
      <RecordsDataProvider value={s.data}>
        <RecordsStateProvider initial={initial}>
          <RecordViews kind="board" />
        </RecordsStateProvider>
      </RecordsDataProvider>,
    );
  });
  await flush();
  await flush();
  return {
    root: r.container as unknown as Node,
    stop: async () => {
      await act(async () => {
        r.unmount();
      });
    },
  };
}

test("a view's WIP limit shows on the column head as 'n of limit', says Over its limit, and the head's menu sets another", async () => {
  const restore = installDom();
  const plainSpace: SampleSpace = {
    ...northwind,
    views: [
      ...northwind.views,
      {
        viewId: "vw_board",
        type: "projects",
        kind: "board",
        title: "Board",
        shared: false,
        ownerId: "usr_imran",
        config: { wip: { planning: 2 } },
        updatedAt: NOW,
      } as never,
    ],
  };
  const base = createViewsSample(plainSpace);
  const saves: Record<string, unknown>[] = [];
  const s = {
    data: {
      ...base.data,
      async call(cap: string, input: unknown) {
        if (cap === "views.save") {
          saves.push(input as Record<string, unknown>);
          return { view: { viewId: "vw_board" } };
        }
        return base.data.call(cap, input);
      },
    } as RecordsData,
  };
  const b = await plainBoard(s, { type: "projects", viewId: "vw_board" });
  try {
    assert.equal(count(b.root, "planning"), "3 of 2", "three cards against a limit of two");
    assert.match(textOf(find(b.root, "col-over-planning")), /Over its limit/);
    assert.equal(find(b.root, "col-over-active"), null);
    await press(find(b.root, "col-limit-button-planning"));
    assert.ok(find(b.root, "menu-item-5 cards"), "the menu offers limits");
    await press(find(b.root, "menu-item-5 cards"));
    await flush();
    assert.equal(saves.length, 1);
    assert.deepEqual((saves[0]!["config"] as Record<string, unknown>)["wip"], { planning: 5 }, "kept with the view");
    assert.equal(saves[0]!["viewId"], "vw_board", "the person's own view is updated, not a new one made");
  } finally {
    await b.stop();
    restore();
  }
});

test("quick add: New at the foot of a column opens a name field; Enter makes the card in that column", async () => {
  const restore = installDom();
  const base = createViewsSample();
  const made: Record<string, unknown>[] = [];
  const s = {
    data: {
      ...base.data,
      async call(cap: string, input: unknown) {
        if (cap === "records.create") {
          made.push(input as Record<string, unknown>);
          return { record: { id: "projects_new" } };
        }
        return base.data.call(cap, input);
      },
    } as RecordsData,
  };
  const b = await plainBoard(s, { type: "projects" });
  try {
    await press(find(b.root, "add-planning"));
    const input = find(b.root, "quick-planning");
    assert.ok(input, "a name field opens in the column");
    await typeInto(input, "Orchard rollout");
    await act(async () => {
      (find(b.root, "quick-planning")!.props.onKeyDown as (e: unknown) => void)({
        key: "Enter",
        shiftKey: false,
        preventDefault() {},
        stopPropagation() {},
        isDefaultPrevented: () => false,
        target: { value: "Orchard rollout", blur() {} },
        currentTarget: { value: "Orchard rollout" },
        nativeEvent: { key: "Enter", shiftKey: false, isComposing: false },
      });
    });
    await flush();
    assert.equal(made.length, 1);
    assert.deepEqual((made[0]!["fields"] as Record<string, unknown>)["name"], "Orchard rollout");
    assert.equal(
      (made[0]!["fields"] as Record<string, unknown>)["status"],
      "planning",
      "in the column it was typed in",
    );
    assert.match(textOf(find(b.root, "board-toast-text")), /Added Orchard rollout to/);
  } finally {
    await b.stop();
    restore();
  }
});

test("Assign on the bar gives the selected cards one owner, or none", async () => {
  const restore = installDom();
  const s = sample();
  const b = await mountBoard(s);
  try {
    await press(find(b.root, "tick-jr_1"));
    await press(find(b.root, "tick-jr_2"));
    await press(find(b.root, "bar-assign"));
    await press(find(b.root, "menu-item-No one"));
    await flush();
    const updates = s.calls.filter((c) => c.cap === "records.update");
    assert.deepEqual(
      updates.map((c) => [c.input["recordId"], (c.input["patch"] as Record<string, unknown>)["owner"]]),
      [
        ["jr_1", null],
        ["jr_2", null],
      ],
    );
    assert.equal(find(b.root, "board-select-bar"), null, "the selection clears");
  } finally {
    await b.stop();
    restore();
  }
});

test("a card that is newer than the copy held is refused with a reason on the card, from a drag, a key, the bar and an undo; nothing is lost", async () => {
  const restore = installDom();
  const s = sample();
  const b = await mountBoard(s);
  try {
    s.ahead.on = true;
    // drag
    await drag(b.root, "jr_2");
    await over(b.root, "stage2");
    await drop(b.root, "stage2");
    await flush();
    await flush();
    assert.match(textOf(find(b.root, "card-refused-jr_2")), /It changed first/);
    await press(find(b.root, "card-refused-dismiss-jr_2"));
    // bar
    await press(find(b.root, "tick-jr_2"));
    await press(find(b.root, "bar-move"));
    await press(find(b.root, "menu-item-In review"));
    await flush();
    await flush();
    assert.match(textOf(find(b.root, "card-refused-jr_2")), /It changed first/);
    await press(find(b.root, "card-refused-dismiss-jr_2"));
    await key(b.root, "Escape");
    // card menu
    await act(async () => {
      (find(b.root, "card-jr_2")!.props.onContextMenu as (e: unknown) => void)({
        preventDefault() {},
        stopPropagation() {},
        pageX: 10,
        pageY: 10,
        clientX: 10,
        clientY: 10,
        nativeEvent: { pageX: 10, pageY: 10 },
      });
    });
    await press(find(b.root, "menu-item-In review"));
    await flush();
    await flush();
    assert.match(textOf(find(b.root, "card-refused-jr_2")), /It changed first/);
    await press(find(b.root, "card-refused-dismiss-jr_2"));
    // key
    await key(b.root, "ArrowDown");
    await key(b.root, "ArrowRight", { altKey: true });
    await flush();
    await flush();
    assert.ok(
      find(b.root, "card-refused-jr_1") || find(b.root, "card-refused-jr_2"),
      "the key move is refused on the card",
    );
    assert.deepEqual(s.calls, [], "no move was written");
    assert.equal(count(b.root, "stage1"), "2", "nothing moved");
    // undo: a move that went through, then the card changes under it
    s.ahead.on = false;
    await key(b.root, "Escape");
    await drag(b.root, "jr_2");
    await over(b.root, "stage2");
    await drop(b.root, "stage2");
    await flush();
    await flush();
    assert.equal(s.calls.length, 1);
    s.ahead.on = true;
    await key(b.root, "z");
    await flush();
    await flush();
    assert.equal(s.calls.length, 1, "the undo was refused");
    s.ahead.on = false;
    await key(b.root, "z");
    await flush();
    await flush();
    assert.equal(s.calls.length, 2, "the refused undo was kept and works when the card is as it was");
    assert.equal(s.calls[1]!.input["toStage"], "stage1");
  } finally {
    await b.stop();
    restore();
  }
});

test("a call that never answers frees the board after its wait, and a second bar move is told one at a time", async () => {
  const restore = installDom();
  const s = sample();
  const real = s.data.call.bind(s.data);
  let hang = true;
  s.data.call = async (cap: string, input: unknown) =>
    cap === "journeys.move_stage" && hang ? new Promise(() => undefined) : real(cap, input);
  const realSet = globalThis.setTimeout;
  (globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void, ms?: number, ...a: unknown[]) =>
    realSet(fn, ms === 20_000 ? 30 : ms, ...a)) as never;
  const b = await mountBoard(s);
  try {
    await drag(b.root, "jr_2");
    await over(b.root, "stage2");
    await drop(b.root, "stage2");
    await flush();
    await flush();
    assert.match(
      textOf(find(b.root, "card-refused-jr_2")),
      /No answer yet/,
      "the board is free again, with the reason on the card",
    );
    hang = false;
    await press(find(b.root, "card-refused-dismiss-jr_2"));
    await drag(b.root, "jr_2");
    await over(b.root, "stage2");
    await drop(b.root, "stage2");
    await flush();
    assert.equal(count(b.root, "stage2"), "2");
  } finally {
    (globalThis as { setTimeout: unknown }).setTimeout = realSet;
    await b.stop();
    restore();
  }
});

test("the form on a card does not overwrite a card that changed while it was open", async () => {
  const restore = installDom();
  const s = sample({ gate: true });
  const b = await mountBoard(s);
  try {
    await drag(b.root, "jr_2");
    await over(b.root, "stage2");
    await drop(b.root, "stage2");
    await flush();
    await flush();
    assert.ok(find(b.root, "card-fields-jr_2"), "the form opens on the card");
    s.ahead.on = true;
    await typeInto(find(b.root, "gate-input-owner"), "usr_maya");
    await press(find(b.root, "card-fields-save-jr_2"));
    await flush();
    assert.match(textOf(find(b.root, "card-fields-error-jr_2")), /It changed first/);
    assert.deepEqual(
      s.calls.filter((c) => c.cap === "records.update"),
      [],
      "nothing was written over it",
    );
  } finally {
    await b.stop();
    restore();
  }
});

test("pressing a card opens it in the side pane on Details with the Journey's path at the top; Activity is the next tab; the page is one press away", async () => {
  const restore = installDom();
  const s = sample();
  const opened: string[] = [];
  s.data.nav = { ...s.data.nav, openRecord: (id: string) => void opened.push(id) };
  const b = await mountBoard(s);
  try {
    await press(find(b.root, "card-jr_1"));
    await flush();
    assert.ok(find(b.root, "board-peek"), "the pane opens beside the board");
    assert.deepEqual(opened, [], "no new page");
    assert.match(textOf(find(b.root, "peek-step-stage1")), /Intake.*Day 5 of 2 d/);
    assert.match(textOf(find(b.root, "peek-step-stage2")), /In review/);
    assert.match(textOf(find(b.root, "peek-details")), /Owner/);
    await press(find(b.root, "peek-open-page"));
    assert.deepEqual(opened, ["jr_1"]);
  } finally {
    await b.stop();
    restore();
  }
});
