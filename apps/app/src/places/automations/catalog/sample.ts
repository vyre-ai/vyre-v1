// Sample catalog for tests that have no runtime. This is not the product catalog.
// Product menus load automations.steps.list and automations.triggers.list, or show that the list is unavailable.
import { availabilityFor, groupFor, PREVIEW_NOTE } from "./model.ts";
import type { CatalogStep, CatalogTrigger } from "./model.ts";

export const SAMPLE_CATALOG = true as const;

const SAMPLE_STEP_ROWS: readonly { key: string; title: string; category: string }[] = [
  { key: "records.find", title: "Find records", category: "data" },
  { key: "records.create", title: "Create a record", category: "data" },
  { key: "send_email", title: "Send an email", category: "send" },
  { key: "send_sms", title: "Send a text message", category: "send" },
  { key: "ai", title: "AI step", category: "ai" },
  { key: "code", title: "Run code", category: "code" },
  { key: "parallel", title: "Parallel", category: "control" },
  { key: "loop", title: "Loop", category: "control" },
  { key: "wait", title: "Wait", category: "wait" },
  { key: "approval", title: "Approval", category: "control" },
  { key: "paths", title: "Paths", category: "control" },
  { key: "stop", title: "Stop", category: "control" },
];

export const SAMPLE_STEPS: readonly CatalogStep[] = SAMPLE_STEP_ROWS.map((row) => {
  const availability = availabilityFor(row.key, "step");
  return {
    key: row.key,
    title: row.title,
    category: row.category,
    group: groupFor(row),
    availability,
    ...(availability === "preview" ? { note: PREVIEW_NOTE } : {}),
  };
});

export const SAMPLE_TRIGGERS: readonly CatalogTrigger[] = (
  [
    { key: "record_change", title: "A record changes" },
    { key: "schedule", title: "On a schedule" },
    { key: "manual", title: "Run by hand" },
  ] as const
).map((row) => {
  const availability = availabilityFor(row.key, "trigger");
  return { key: row.key, title: row.title, availability, ...(availability === "preview" ? { note: PREVIEW_NOTE } : {}) };
});
