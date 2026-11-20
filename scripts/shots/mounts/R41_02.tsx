// Mount for lane r41-kanban (19 Nov 2026): the Kanban board over a Journey's customers, one part at a time. ?part=board | big | visual. The shoot script (r41-kanban-shoot.mjs) presses what it needs.
// Exists only in the shots build; nothing here ships.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import {
  RecordsDataProvider,
  RecordsSidebar,
  RecordsStateProvider,
} from "../../../apps/app/src/places/records/sidebar/index.ts";
import type { RecordsData } from "../../../apps/app/src/places/records/sidebar/index.ts";
import { RecordViews } from "../../../apps/app/src/places/records/views-a/index.ts";
import { northwind } from "../../../apps/app/src/places/records/views-a/sample.ts";
import { createSampleRecords } from "../../../apps/app/src/places/records/table/sample.ts";
import type { SampleSpace } from "../../../apps/app/src/places/records/table/sample.ts";
import type { FieldDef, RecordRow, TypeDef } from "../../../apps/app/src/places/records/table/model.ts";

export const title = "The Kanban board";

const NOW = Date.now();
const DAY = 86_400_000;
const f = (
  key: string,
  type: string,
  title: string,
  options?: Record<string, unknown>,
  extra: Partial<FieldDef> = {},
): FieldDef => ({
  key,
  type,
  title,
  ...(options ? { options } : {}),
  ...extra,
});
const STAGES = {
  stages: [
    { key: "lead", title: "Lead" },
    { key: "qual", title: "Qualified" },
    { key: "prop", title: "Proposal" },
    { key: "sign", title: "Signing" },
    { key: "won", title: "Won" },
    { key: "lost", title: "Lost" },
  ],
};
const DEALS: TypeDef = {
  key: "journey_clients",
  title: "Clients",
  plural: "Clients",
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
    f("agreement", "choice", "Agreement", {
      choices: [
        { key: "none", title: "No agreement" },
        { key: "sent", title: "Agreement sent" },
        { key: "signed", title: "Signed" },
      ],
    }),
    f("subject", "relation", "Subject", { target: "clients" }),
  ],
};
const DESIGN = [
  { key: "lead", title: "Lead", order: 0, timeLimit: { hours: 72 } },
  { key: "qual", title: "Qualified", order: 1, timeLimit: { hours: 120 } },
  { key: "prop", title: "Proposal", order: 2, timeLimit: { hours: 120 }, needToEnter: ["amount"] },
  { key: "sign", title: "Signing", order: 3, timeLimit: { hours: 168 } },
  { key: "won", title: "Won", order: 4, final: true },
  { key: "lost", title: "Lost", order: 5, final: true },
].map((s) => ({ ...s, tasks: [], automations: [], exit: { requireTasks: false } }));
const WHO = ["usr_maya", "usr_omar", "usr_lena", "usr_sam"];
const NAMES = [
  "Harbor Co",
  "Northwind Foods",
  "Bluebird Studio",
  "Summit Row",
  "Cedar Works",
  "Ironbridge",
  "Lumen Labs",
  "Orchard Group",
  "Pinecone Retail",
  "Quarry Bay",
  "Redwood Supply",
  "Stonebridge",
];
const row = (i: number, stage: string, ageDays: number, amount: number | null, agreement = "none"): RecordRow => ({
  id: `cl_${i}`,
  type: DEALS.key,
  version: 1,
  label: 1,
  createdAt: NOW - 30 * DAY,
  updatedAt: NOW - ageDays * DAY,
  holds: 0,
  fields: {
    name: NAMES[i % NAMES.length]! + (i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : ""),
    stage,
    owner: WHO[i % WHO.length],
    agreement,
    ...(amount ? { amount: { amount, currency: "USD" } } : {}),
  },
});
const SMALL: RecordRow[] = [
  row(0, "lead", 1, 18000),
  row(1, "lead", 2, 9000),
  row(2, "lead", 4, 24000),
  row(3, "qual", 2, 31000),
  row(4, "qual", 7, 12000),
  row(5, "prop", 1, 42000, "sent"),
  row(6, "prop", 3, 16000, "sent"),
  row(7, "sign", 2, 27000, "signed"),
  row(8, "sign", 9, 8000, "sent"),
  row(9, "won", 3, 52000, "signed"),
  row(10, "lost", 11, 6000),
  row(11, "qual", 3, null),
];
const BIG: RecordRow[] = [
  ...SMALL,
  ...Array.from({ length: 3000 }, (_, i) => row(100 + i, "lead", i % 6, 1000 + (i % 40) * 500)),
];

function Board({ part }: { part: string }): ReactNode {
  const narrow = useWindowDimensions().width < 700;
  const rows = part === "big" ? BIG : SMALL;
  const sample = useMemo(() => {
    const space: SampleSpace = {
      ...northwind,
      types: [...northwind.types, DEALS],
      counts: { ...northwind.counts, [DEALS.key]: rows.length },
      views: [
        ...northwind.views,
        // the person's own view of the board: the limits a stage should hold at most
        {
          viewId: "vw_pipeline",
          type: DEALS.key,
          kind: "board",
          title: "Pipeline",
          shared: false,
          ownerId: "usr_imran",
          config: { wip: { qual: 6, prop: 5, sign: 3 } },
          updatedAt: NOW,
        } as never,
      ],
      rows: { [DEALS.key]: rows as never },
    };
    const base = createSampleRecords(space);
    const table = `records:${DEALS.key}`;
    const data: RecordsData = {
      ...base.data,
      async call(cap, input) {
        const i = input as Record<string, unknown>;
        if (cap === "journeys.list")
          return {
            journeys: [
              {
                id: "jrn_1",
                name: "Client onboarding",
                subjectType: "clients",
                recordType: DEALS.key,
                version: 1,
                stages: 6,
                inFlight: rows.length,
                updatedAt: NOW,
              },
            ],
          };
        if (cap === "journeys.get") return { journey: { id: "jrn_1", stages: DESIGN } };
        if (cap === "journeys.stage_counts")
          return {
            stages: [
              { stage: "lead", count: 3, overLimit: 1 },
              { stage: "qual", count: 3, overLimit: 1 },
              { stage: "sign", count: 2, overLimit: 1 },
            ],
          };
        // when each card entered its stage (the Journey's own read): a few days ago, so cards show their day and the late ones their late mark
        if (cap === "journeys.stage_since") {
          const ids = (i["recordIds"] as string[]) ?? [];
          const since: Record<string, number> = {};
          for (const id of ids) {
            const r = (base.replica.rows(table) as unknown as RecordRow[]).find((x) => x.id === id);
            if (r) since[id] = r.updatedAt;
          }
          return { since };
        }
        if (cap === "records.activity") return { entries: [{ id: "e1", kind: "stage", at: NOW, actor: "usr_omar" }] };
        if (cap === "records.get")
          return { record: (base.replica.rows(table) as unknown as RecordRow[]).find((r) => r.id === i["recordId"]) };
        if (cap === "journeys.move_stage") {
          const cur = (base.replica.rows(table) as unknown as RecordRow[]).find((r) => r.id === i["recordId"])!;
          if (i["toStage"] === "prop" && !cur.fields["amount"])
            throw Object.assign(new Error("fields required"), {
              details: {
                reason: "fields_required",
                toStage: "prop",
                fields: [{ key: "amount", title: "Amount", stage: "prop", when: "enter" }],
              },
            });
          if (i["toStage"] === "sign" && cur.fields["agreement"] !== "signed")
            throw new Error("stage precondition: required task agreement is not done (validation.precondition_failed)");
          base.replica.put(table, [
            {
              ...cur,
              version: cur.version + 1,
              updatedAt: Date.now(),
              fields: { ...cur.fields, stage: i["toStage"] },
            } as never,
          ]);
          return { recordId: i["recordId"], stage: i["toStage"] };
        }
        if (cap === "records.update") {
          const cur = (base.replica.rows(table) as unknown as RecordRow[]).find((r) => r.id === i["recordId"])!;
          base.replica.put(table, [
            { ...cur, version: cur.version + 1, fields: { ...cur.fields, ...(i["patch"] as object) } } as never,
          ]);
          return {};
        }
        if (cap === "views.save") return { view: { viewId: "view_mine" } };
        return base.data.call(cap, input);
      },
    };
    return data;
  }, [rows]);
  return (
    <RecordsDataProvider value={sample}>
      <RecordsStateProvider initial={{ type: DEALS.key, viewId: "vw_pipeline" }}>
        <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
          {narrow ? null : (
            <View style={{ width: 240 }}>
              <RecordsSidebar />
            </View>
          )}
          <RecordViews />
        </View>
      </RecordsStateProvider>
    </RecordsDataProvider>
  );
}

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => {
    setPart(
      new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ??
        "board",
    );
  }, []);
  if (!part) return null;
  return <Board part={part} />;
}
