// Parsers for the operations screens. They read lists the server already returned. They do not invent rows.

const STATUSES = ["queued", "running", "waiting", "succeeded", "failed", "stopped"] as const;

export function countRuns(runs: { status?: unknown; costMicros?: unknown }[]): { text: string } | null {
  if (!Array.isArray(runs)) return null;
  const n: Record<string, number> = {};
  for (const name of STATUSES) n[name] = 0;
  let cost = 0;
  let sawCost = false;
  for (const run of runs) {
    if (run && typeof run.status === "string" && run.status in n) n[run.status] += 1;
    if (run && typeof run.costMicros === "number" && Number.isFinite(run.costMicros)) { cost += run.costMicros; sawCost = true; }
  }
  const text = STATUSES.map((name) => `${n[name]} ${name}`).join(", ");
  return { text: sawCost ? `${text}. Cost ${cost}.` : `${text}.` };
}

function literal(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim() || value.includes("{{")) return undefined;
  return value;
}

export function eventRows(out: unknown): { id: string; line: string }[] | null {
  if (!out || typeof out !== "object" || !Array.isArray((out as { events?: unknown }).events)) return null;
  const rows: { id: string; line: string }[] = [];
  for (const row of (out as { events: unknown[] }).events) {
    if (!row || typeof row !== "object") continue;
    const event = row as Record<string, unknown>;
    if (typeof event.id !== "string" || typeof event.type !== "string") continue;
    const when = typeof event.at === "number" ? ` ${new Date(event.at).toISOString()}` : "";
    const payload = event.payload;
    const sealed = !!payload && typeof payload === "object" && (payload as { sealed?: unknown }).sealed === true;
    if (sealed) {
      rows.push({ id: event.id, line: `${event.type}${when} sealed` });
      continue;
    }
    const subject = event.subject && typeof event.subject === "object" ? event.subject as { type?: unknown; id?: unknown } : undefined;
    const subjectBit = subject && typeof subject.type === "string" && typeof subject.id === "string" ? ` ${subject.type} ${subject.id}` : "";
    const runBit = typeof event.runId === "string" ? ` run ${event.runId}` : "";
    rows.push({ id: event.id, line: `${event.type}${when}${subjectBit}${runBit}` });
  }
  return rows;
}

export interface DependencyNode { key: string; input: Record<string, unknown> }
export interface DependencyAutomation { id: string; name: string; nodes: DependencyNode[] }

export function dependenciesFrom(automations: readonly DependencyAutomation[]): { id: string; line: string }[] {
  const rows: { id: string; line: string }[] = [];
  const seen = new Set<string>();
  const add = (automation: DependencyAutomation, kind: string, value: string): void => {
    const id = `${automation.id}:${kind}:${value}`;
    if (seen.has(id)) return;
    seen.add(id);
    rows.push({ id, line: `Automation ${automation.name} uses ${kind} ${value}` });
  };
  for (const automation of automations) {
    for (const node of automation.nodes) {
      const input = node.input ?? {};
      const automationId = literal(input.automationId);
      if (automationId) add(automation, "automation", automationId);
      if (node.key === "start_journey" || node.key === "call_automation") {
        const journeyId = literal(input.journeyId);
        if (journeyId) add(automation, "journey", journeyId);
      }
      const mailboxId = literal(input.mailboxId);
      if (mailboxId) add(automation, "mailbox", mailboxId);
      const numberId = literal(input.numberId);
      if (numberId) add(automation, "number", numberId);
      const connectionId = literal(input.connectionId);
      if (connectionId) add(automation, "connection", connectionId);
    }
  }
  return rows;
}

export interface NamedRow { id: string; name: string }

function namedRows(out: unknown, key: "packages" | "automations"): NamedRow[] | null {
  if (!out || typeof out !== "object" || !Array.isArray((out as Record<string, unknown>)[key])) return null;
  const rows: NamedRow[] = [];
  for (const row of (out as Record<string, unknown[]>)[key] ?? []) {
    if (!row || typeof row !== "object") continue;
    const id = (row as { id?: unknown }).id;
    const name = (row as { name?: unknown }).name;
    if (typeof id !== "string" || typeof name !== "string" || !id || !name) continue;
    rows.push({ id, name });
  }
  return rows;
}

export function packageRows(out: unknown): NamedRow[] | null {
  return namedRows(out, "packages");
}

export function exportChoices(out: unknown): NamedRow[] | null {
  return namedRows(out, "automations");
}

// ---- Studio views: the shapes the server returns, parsed once. A reply that does not match is null, never a guess. ----

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null);

export interface Analytics {
  windowDays: number;
  totals: { runs: number; succeeded: number; failed: number; stopped: number; active: number; costMicros: number; successRate: number | null; medianMs: number | null };
  daily: { day: string; succeeded: number; failed: number; other: number }[];
  automations: { automationId: string; name: string; runs: number; succeeded: number; failed: number; lastRunAt: number }[];
  failures: { automationId: string | null; step: string; code: string; count: number }[];
}

export function analyticsOf(out: unknown): Analytics | null {
  const o = obj(out);
  const t = obj(o?.["totals"]);
  if (!o || !t || !Array.isArray(o["daily"]) || !Array.isArray(o["automations"]) || !Array.isArray(o["failures"])) return null;
  const rows = <T,>(list: unknown[], take: (r: Record<string, unknown>) => T | null): T[] => list.flatMap((r) => { const x = obj(r); const got = x ? take(x) : null; return got ? [got] : []; });
  return {
    windowDays: num(o["windowDays"]),
    totals: {
      runs: num(t["runs"]), succeeded: num(t["succeeded"]), failed: num(t["failed"]), stopped: num(t["stopped"]), active: num(t["active"]), costMicros: num(t["costMicros"]),
      successRate: typeof t["successRate"] === "number" ? t["successRate"] : null, medianMs: typeof t["medianMs"] === "number" ? t["medianMs"] : null,
    },
    daily: rows(o["daily"] as unknown[], (r) => (typeof r["day"] === "string" ? { day: r["day"], succeeded: num(r["succeeded"]), failed: num(r["failed"]), other: num(r["other"]) } : null)),
    automations: rows(o["automations"] as unknown[], (r) => (typeof r["automationId"] === "string" && typeof r["name"] === "string"
      ? { automationId: r["automationId"], name: r["name"], runs: num(r["runs"]), succeeded: num(r["succeeded"]), failed: num(r["failed"]), lastRunAt: num(r["lastRunAt"]) } : null)),
    failures: rows(o["failures"] as unknown[], (r) => (typeof r["step"] === "string" && typeof r["code"] === "string"
      ? { automationId: typeof r["automationId"] === "string" ? r["automationId"] : null, step: r["step"], code: r["code"], count: num(r["count"]) } : null)),
  };
}

/** "92%" for a rate, "none yet" before any run has finished. */
export const rateWords = (rate: number | null): string => (rate === null ? "None yet" : `${Math.round(rate * 100)}%`);

/** "850 ms", "4.2 s", "3 min" for a duration. */
export function durationWords(ms: number | null): string {
  if (ms === null) return "None yet";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

export interface DepUse { automationId: string; name: string; status: string; stepIds: string[] }
export interface DepItem { kind: string; ref: string; problem: "missing" | "off" | null; usedBy: DepUse[] }

export function depsOf(out: unknown): { automations: number; items: DepItem[] } | null {
  const o = obj(out);
  if (!o || !Array.isArray(o["items"])) return null;
  const items: DepItem[] = [];
  for (const raw of o["items"]) {
    const r = obj(raw);
    if (!r || typeof r["kind"] !== "string" || typeof r["ref"] !== "string" || !Array.isArray(r["usedBy"])) continue;
    const usedBy: DepUse[] = [];
    for (const u of r["usedBy"]) {
      const x = obj(u);
      if (x && typeof x["automationId"] === "string" && typeof x["name"] === "string") {
        usedBy.push({ automationId: x["automationId"], name: x["name"], status: typeof x["status"] === "string" ? x["status"] : "", stepIds: Array.isArray(x["stepIds"]) ? x["stepIds"].filter((s): s is string => typeof s === "string") : [] });
      }
    }
    items.push({ kind: r["kind"], ref: r["ref"], problem: r["problem"] === "missing" || r["problem"] === "off" ? r["problem"] : null, usedBy });
  }
  return { automations: num(o["automations"]), items };
}

export interface EventItem {
  id: string; type: string; at: number; actor: string; sealed: boolean;
  subject?: { type: string; id: string }; runId?: string; payload: unknown;
}

export function eventItems(out: unknown): EventItem[] | null {
  const o = obj(out);
  if (!o || !Array.isArray(o["events"])) return null;
  const rows: EventItem[] = [];
  for (const raw of o["events"]) {
    const e = obj(raw);
    if (!e || typeof e["id"] !== "string" || typeof e["type"] !== "string") continue;
    const sealed = obj(e["payload"])?.["sealed"] === true;
    const s = obj(e["subject"]);
    rows.push({
      id: e["id"], type: e["type"], at: num(e["at"]), actor: typeof e["actor"] === "string" ? e["actor"] : "", sealed,
      ...(s && typeof s["type"] === "string" && typeof s["id"] === "string" ? { subject: { type: s["type"], id: s["id"] } } : {}),
      ...(typeof e["runId"] === "string" ? { runId: e["runId"] } : {}),
      payload: sealed ? null : e["payload"] ?? null,
    });
  }
  return rows;
}

export interface TemplateItem { key: string; title: string; summary: string; starts: string; setUp: string[]; steps: { id: string; key: string; title: string }[] }

export function templatesOf(out: unknown): TemplateItem[] | null {
  const o = obj(out);
  if (!o || !Array.isArray(o["templates"])) return null;
  const rows: TemplateItem[] = [];
  for (const raw of o["templates"]) {
    const t = obj(raw);
    if (!t || typeof t["key"] !== "string" || typeof t["title"] !== "string") continue;
    const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
    const steps = Array.isArray(t["steps"]) ? t["steps"].flatMap((s) => { const x = obj(s); return x && typeof x["id"] === "string" && typeof x["title"] === "string" ? [{ id: x["id"], key: typeof x["key"] === "string" ? x["key"] : "", title: x["title"] }] : []; }) : [];
    rows.push({ key: t["key"], title: t["title"], summary: typeof t["summary"] === "string" ? t["summary"] : "", starts: typeof t["starts"] === "string" ? t["starts"] : "", setUp: strings(t["setUp"]), steps });
  }
  return rows;
}

export interface PackageItem { id: string; name: string; sourceAutomationId: string; createdAt: number; requires: { connections: { slot: string; label: string; stepIds: string[] }[]; vault: string[]; keys: string[] } }

export function packageItems(out: unknown): PackageItem[] | null {
  const o = obj(out);
  if (!o || !Array.isArray(o["packages"])) return null;
  const rows: PackageItem[] = [];
  for (const raw of o["packages"]) {
    const p = obj(raw);
    if (!p || typeof p["id"] !== "string" || typeof p["name"] !== "string") continue;
    const req = obj(p["requires"]);
    const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
    const connections = Array.isArray(req?.["connections"]) ? req["connections"].flatMap((c) => { const x = obj(c); return x && typeof x["slot"] === "string" ? [{ slot: x["slot"], label: typeof x["label"] === "string" ? x["label"] : x["slot"], stepIds: strings(x["stepIds"]) }] : []; }) : [];
    rows.push({ id: p["id"], name: p["name"], sourceAutomationId: typeof p["sourceAutomationId"] === "string" ? p["sourceAutomationId"] : "", createdAt: num(p["createdAt"]), requires: { connections, vault: strings(req?.["vault"]), keys: strings(req?.["keys"]) } });
  }
  return rows;
}

/** [{ value, count }] in first-seen order of a sorted key list: the numbers a filter menu shows beside each choice. */
export function countBy<T>(rows: readonly T[], key: (row: T) => string): { value: string; count: number }[] {
  const n = new Map<string, number>();
  for (const r of rows) n.set(key(r), (n.get(key(r)) ?? 0) + 1);
  return [...n.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => (a.value < b.value ? -1 : 1));
}
