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
