// Catalog availability for the builder. The product list comes from automations.steps.list and automations.triggers.list.
// ai stays Preview. code runs in the step sandbox. Parallel, Loop, and a schedule are ordinary flow steps.
import type { IconKey } from "../canvas/model.ts";

export type Availability = "available" | "needs_setup" | "preview" | "unavailable";

export const PREVIEW_NOTE = "Preview. Visible for design. It will not run live in this release.";

export interface CatalogStep {
  key: string;
  title: string;
  category: string;
  group: string;
  availability: Availability;
  input?: unknown;
  output?: unknown;
  effects?: string;
  note?: string;
}

export interface CatalogTrigger {
  key: string;
  title: string;
  availability: Availability;
  sample?: unknown;
  personalOk?: boolean;
  note?: string;
}

const LOGIC = new Set(["paths", "if", "parallel", "loop", "wait", "wait_stage", "stop"]);

export function availabilityFor(key: string, kind: "step" | "trigger"): Availability {
  if (kind === "step" && key === "ai") return "preview";
  return "available";
}

export function isPreviewKey(key: string | undefined, kind: "step" | "trigger" = "step"): boolean {
  return key !== undefined && availabilityFor(key, kind) === "preview";
}

const CONNECTED = /^(google\.|ms\.|github\.|sheet\.)/;
const VYRE_PRODUCT = /^(calendar\.|files\.|forms\.)/;

/** Connected-app order: common operations for one app, then the next app, then the authenticated request. */
const CONNECTED_ORDER = [
  "google.gmail.list_messages", "google.gmail.send_message", "google.calendar.list_events", "google.calendar.create_event",
  "google.drive.list_files", "google.drive.create_folder", "google.sheets.get_values", "google.sheets.append_values", "google.docs.create_document",
  "ms.mail.list_messages", "ms.mail.send_message", "ms.calendar.list_events", "ms.calendar.create_event", "ms.drive.list_items", "ms.drive.create_folder",
  "github.repos.list", "github.pull_request.get", "github.issue.create", "github.issue.comment", "github.issue.assign_agent",
  "sheet.find_rows", "sheet.add_rows", "sheet.update_rows", "sheet.create", "sheet.read_all", "sheet.delete_rows",
  "send_email", "send_sms", "post_message", "connector_request",
];

export function groupFor(step: { key: string; category?: string }): string {
  if (availabilityFor(step.key, "step") === "preview") return "Preview";
  if (LOGIC.has(step.key)) return "Logic";
  if (step.key === "approval") return "Human input";
  if (CONNECTED.test(step.key) || step.key === "connector_request" || step.key === "send_email" || step.key === "send_sms" || step.key === "post_message") return "Connected apps";
  if (VYRE_PRODUCT.test(step.key) || step.key === "sign" || step.key === "create_task") return "Vyre";
  switch (step.category) {
    case "data": return "Data & transforms";
    case "send":
    case "sheet": return "Connected apps";
    case "sign": return "Vyre";
    case "journey": return "Sub-Automations";
    case "control":
    case "wait": return "Logic";
    default: return "Vyre";
  }
}

function rankOf(item: { key?: string }): number {
  if (typeof item.key !== "string") return 800;
  const at = CONNECTED_ORDER.indexOf(item.key);
  return at === -1 ? 700 : at;
}

const GROUP_ORDER = ["Suggested", "Vyre", "Connected apps", "Logic", "Data & transforms", "Human input", "Sub-Automations", "Preview"];

export function menuGroups<T extends { group: string }>(items: readonly T[]): { head: string; items: T[] }[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const list = buckets.get(item.group) ?? [];
    list.push(item);
    buckets.set(item.group, list);
  }
  const out: { head: string; items: T[] }[] = [];
  for (const head of GROUP_ORDER) {
    const grouped = buckets.get(head);
    if (grouped && grouped.length > 0) {
      const items = head === "Connected apps" ? [...grouped].sort((a, b) => rankOf(a) - rankOf(b)) : grouped;
      out.push({ head, items });
    }
  }
  for (const [head, grouped] of buckets) if (!GROUP_ORDER.includes(head) && grouped.length > 0) out.push({ head, items: grouped });
  return out;
}

function rowKey(row: unknown): { key: string; title: string } | null {
  if (!row || typeof row !== "object") return null;
  const rec = row as Record<string, unknown>;
  if (typeof rec["key"] !== "string" || typeof rec["title"] !== "string") return null;
  return { key: rec["key"], title: rec["title"] };
}

export function stepsFromRuntime(out: unknown): CatalogStep[] | null {
  if (!out || typeof out !== "object" || !Array.isArray((out as { steps?: unknown }).steps)) return null;
  const steps: CatalogStep[] = [];
  for (const row of (out as { steps: unknown[] }).steps) {
    const base = rowKey(row);
    if (!base) return null;
    const rec = row as Record<string, unknown>;
    const availability = availabilityFor(base.key, "step");
    const category = typeof rec["category"] === "string" ? rec["category"] : "";
    steps.push({
      key: base.key,
      title: base.title,
      category,
      group: groupFor({ key: base.key, category }),
      availability,
      ...(rec["input"] !== undefined ? { input: rec["input"] } : {}),
      ...(rec["output"] !== undefined ? { output: rec["output"] } : {}),
      ...(typeof rec["effects"] === "string" ? { effects: rec["effects"] } : {}),
      ...(availability === "preview" ? { note: PREVIEW_NOTE } : {}),
    });
  }
  return steps;
}

export function triggersFromRuntime(out: unknown): CatalogTrigger[] | null {
  if (!out || typeof out !== "object" || !Array.isArray((out as { triggers?: unknown }).triggers)) return null;
  const triggers: CatalogTrigger[] = [];
  for (const row of (out as { triggers: unknown[] }).triggers) {
    const base = rowKey(row);
    if (!base) return null;
    const rec = row as Record<string, unknown>;
    const availability = availabilityFor(base.key, "trigger");
    triggers.push({
      key: base.key,
      title: base.title,
      availability,
      ...(rec["sample"] !== undefined ? { sample: rec["sample"] } : {}),
      ...(typeof rec["personalOk"] === "boolean" ? { personalOk: rec["personalOk"] } : {}),
      ...(availability === "preview" ? { note: PREVIEW_NOTE } : {}),
    });
  }
  return triggers;
}

export interface ProductCatalog {
  steps: CatalogStep[];
  triggers: CatalogTrigger[];
}

export async function loadProductCatalog(call: (cap: string, input: unknown) => Promise<unknown>): Promise<{ ok: true; catalog: ProductCatalog } | { ok: false; message: string }> {
  try {
    const [stepsOut, triggersOut] = await Promise.all([
      call("automations.steps.list", {}),
      call("automations.triggers.list", {}),
    ]);
    const steps = stepsFromRuntime(stepsOut);
    const triggers = triggersFromRuntime(triggersOut);
    if (!steps || !triggers) return { ok: false, message: "The step catalog did not return a list." };
    return { ok: true, catalog: { steps, triggers } };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "The step catalog is not available." };
  }
}

const STEP_ICON: Readonly<Record<string, IconKey>> = {
  "records.find": "search", "records.create": "plus", "records.update": "edit", create_task: "task",
  send_email: "send", send_sms: "phone", post_message: "chat", ai: "ai", approval: "shield",
  paths: "branch", parallel: "parallel", loop: "loop", wait: "hourglass", stop: "stop",
  start_journey: "journey", wait_stage: "hourglass", "sheet.add_rows": "sheet", "sheet.find_rows": "search",
  "sheet.update_rows": "edit", sign: "sign", code: "code",
};

const TRIGGER_ICON: Readonly<Record<string, IconKey>> = {
  record_change: "bolt", schedule: "clock", webhook: "hook", form_submit: "inbox", email_received: "mail",
  chat_message: "chat", spreadsheet_row: "sheet", ci_check: "ci", meeting_transcript_ready: "meeting",
  journey_stage_entered: "stage", campaign_reply: "reply", button: "button", manual: "hand",
};

export function iconForStep(key: string): IconKey {
  return STEP_ICON[key] ?? (key.startsWith("records.") ? "record" : key.startsWith("sheet.") ? "sheet" : "record");
}

export function iconForTrigger(key: string): IconKey {
  return TRIGGER_ICON[key] ?? "bolt";
}

/** JSON Schema properties, when the catalog published an object schema. Otherwise no invented fields. */
export function schemaFields(input: unknown): { name: string; type: string }[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  const props = (input as { properties?: unknown }).properties;
  if (!props || typeof props !== "object" || Array.isArray(props)) return [];
  const fields: { name: string; type: string }[] = [];
  for (const [name, def] of Object.entries(props)) {
    const type = def && typeof def === "object" && typeof (def as { type?: unknown }).type === "string" ? (def as { type: string }).type : "unknown";
    fields.push({ name, type });
  }
  return fields;
}
