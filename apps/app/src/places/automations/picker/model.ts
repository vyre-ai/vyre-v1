// The step picker and the "Connect an app" sheet (owner, 13 Nov 2026, design 2.4 and 4F). Pure: the screen hands in the catalog's steps and what this person has and may use; rows come back.
// "It should only show me the things that I have in vault and have access to setup." Vyre's own groups, then only apps he has connected and may use, one row per app with its actions in a submenu.

export interface PickStep {
  key: string;
  title: string;
  description?: string;
  /** Plain search words. The step key is never searched: a person does not know it. */
  keywords?: string;
  /** A connector action someone built: its connector's id and the action. */
  preset?: { connector?: string; action?: string };
}

export interface PickApp {
  id: string;
  name: string;
  /** The Space has it connected. */
  connected: boolean;
  /** This person may use it in a step. */
  mayUse: boolean;
  /** A company key: no person's Automation may use it, so it is never offered. */
  company?: boolean;
  /** Who can connect it when he cannot. */
  admin?: string;
  /** The Vault item it would be made from. */
  vault?: { item: string; use: "use" | "view" | "none"; assistant: "cleared" | "owner" | "admin" };
}

export interface PickIn {
  steps: readonly PickStep[];
  apps: readonly PickApp[];
  /** Step ids that fit after the previous step, best first. */
  suggested?: readonly string[];
  /** What the previous step gives, in words ("name, email"). */
  suggestedFrom?: string;
}

export interface Mark {
  /** What AppLogo draws: an app id, or `vyre:<group>` for Vyre's own. */
  app: string;
  name: string;
}

export type PickRow =
  | { kind: "heading"; text: string; note?: string }
  | {
      kind: "step";
      id: string;
      stepKey: string;
      preset?: PickStep["preset"];
      title: string;
      desc?: string;
      mark: Mark;
      where?: string;
    }
  | { kind: "group"; id: string; title: string; count: number; mark: Mark }
  | { kind: "app"; id: string; title: string; count: number; mark: Mark }
  | { kind: "connect"; title: "Connect an app" };

type StepRow = Extract<PickRow, { kind: "step" }>;

export const INTENTS: readonly { id: string; title: string }[] = [
  { id: "msg", title: "Messages" },
  { id: "tasks", title: "Tasks" },
  { id: "files", title: "Files" },
  { id: "docs", title: "Documents and signing" },
  { id: "cal", title: "Calendar" },
  { id: "records", title: "Records" },
  { id: "forms", title: "Forms" },
  { id: "ai", title: "Agent" },
  { id: "logic", title: "Decide and wait" },
];
const MORE = { id: "more", title: "More" };

/** Which of Vyre's own groups a step belongs to. */
export function intentOfKey(key: string): string {
  if (key === "send_email" || key === "send_sms" || key === "post_message") return "msg";
  if (key === "create_task") return "tasks";
  if (key.startsWith("files.")) return "files";
  if (key === "sign") return "docs";
  if (key.startsWith("calendar.")) return "cal";
  if (key.startsWith("records.") || key.startsWith("sheet.")) return "records";
  if (key.startsWith("forms.")) return "forms";
  if (key === "ai" || key === "code") return "ai";
  if (
    [
      "approval",
      "wait",
      "wait_stage",
      "if",
      "paths",
      "parallel",
      "loop",
      "stop",
      "transform",
      "collect",
      "group_by",
      "call_automation",
      "start_journey",
    ].includes(key)
  )
    return "logic";
  return MORE.id;
}

/** The app a step belongs to, or null for Vyre's own. */
export function appOfStep(s: PickStep): string | null {
  const k = s.key;
  if (k.startsWith("google.")) return "google";
  if (k.startsWith("ms.")) return "microsoft";
  if (k.startsWith("github.")) return "github";
  if (k === "connector_request" && s.preset?.connector) return s.preset.connector;
  return null;
}

const stepId = (s: PickStep): string =>
  s.preset?.connector ? `${s.key}:${s.preset.connector}.${s.preset.action ?? ""}` : s.key;

const usable = (a: PickApp): boolean => a.connected && a.mayUse && !a.company;

interface View {
  steps: { step: PickStep; app: PickApp | null; group: { id: string; title: string } }[];
  apps: PickApp[];
}

function view(m: PickIn): View {
  const byId = new Map(m.apps.map((a) => [a.id, a]));
  const steps: View["steps"] = [];
  for (const step of m.steps) {
    const appId = appOfStep(step);
    if (appId !== null) {
      const app = byId.get(appId);
      // an app he cannot use is absent, whatever the server listed
      if (!app || !usable(app)) continue;
      steps.push({ step, app, group: { id: app.id, title: app.name } });
      continue;
    }
    // a request with no connector behind it is a half step: it has nothing to run on
    if (step.key === "connector_request") continue;
    const intent = INTENTS.find((i) => i.id === intentOfKey(step.key)) ?? MORE;
    steps.push({ step, app: null, group: intent });
  }
  return { steps, apps: m.apps.filter(usable) };
}

const markOf = (v: View["steps"][number]): Mark =>
  v.app ? { app: v.app.id, name: v.app.name } : { app: `vyre:${v.group.id}`, name: v.group.title };

const stepRow = (v: View["steps"][number], where?: string): StepRow => ({
  kind: "step",
  id: stepId(v.step),
  stepKey: v.step.key,
  ...(v.step.preset ? { preset: v.step.preset } : {}),
  title: v.step.title,
  ...(v.step.description ? { desc: v.step.description } : {}),
  mark: markOf(v),
  ...(where ? { where } : {}),
});

function editDistance(a: string, b: string): number {
  const d: number[][] = [];
  for (let i = 0; i <= a.length; i++) d[i] = [i];
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  return d[a.length]![b.length]!;
}

/** 0 for no match; higher is better. Prefix beats word start beats inside beats a near miss. */
export function score(query: string, text: string | undefined): number {
  const q = query.trim().toLowerCase();
  const t = (text ?? "").toLowerCase();
  if (q === "" || t === "") return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 90;
  const words = t.split(/[^a-z0-9]+/).filter(Boolean);
  if (words.some((w) => w.startsWith(q))) return 80;
  if (t.includes(q)) return 60;
  const qs = q.split(/\s+/).filter(Boolean);
  if (qs.length > 1 && qs.every((w) => t.includes(w))) return 50;
  // a near miss: the same first letter, so "gmail" does not find "email"
  if (q.length >= 4) {
    const slack = q.length >= 8 ? 2 : 1;
    for (const w of words) {
      if (w[0] !== q[0] || w.length < 3) continue;
      if (editDistance(q, w.slice(0, q.length)) <= slack || editDistance(q, w) <= slack) return 40;
    }
  }
  return 0;
}

export function pickerRows(m: PickIn, query: string): PickRow[] {
  const v = view(m);
  const q = query.trim();
  if (q !== "") {
    const hits = v.steps
      .map((x) => ({
        x,
        s: Math.max(
          score(q, x.step.title),
          score(q, x.step.description) * 0.8,
          score(q, x.step.keywords) * 0.8,
          score(q, x.group.title) * 0.7,
        ),
      }))
      .filter((h) => h.s > 0)
      .sort((a, b) => b.s - a.s);
    return [...hits.map((h) => stepRow(h.x, h.x.group.title)), { kind: "connect", title: "Connect an app" }];
  }
  const rows: PickRow[] = [];
  const byId = new Map(v.steps.map((x) => [stepId(x.step), x]));
  const sg = (m.suggested ?? []).flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])).slice(0, 3);
  if (sg.length > 0) {
    rows.push({
      kind: "heading",
      text: "Suggested next",
      ...(m.suggestedFrom ? { note: `uses ${m.suggestedFrom}` } : {}),
    });
    for (const x of sg) rows.push(stepRow(x));
  }
  const groups = [...INTENTS, MORE].flatMap((g) => {
    const n = v.steps.filter((x) => !x.app && x.group.id === g.id).length;
    return n > 0 ? [{ g, n }] : [];
  });
  if (groups.length > 0) {
    rows.push({ kind: "heading", text: "Vyre" });
    for (const { g, n } of groups)
      rows.push({
        kind: "group",
        id: `group:${g.id}`,
        title: g.title,
        count: n,
        mark: { app: `vyre:${g.id}`, name: g.title },
      });
  }
  const apps = v.apps.flatMap((a) => {
    const n = v.steps.filter((x) => x.app?.id === a.id).length;
    return n > 0 ? [{ a, n }] : [];
  });
  if (apps.length > 0) {
    rows.push({ kind: "heading", text: "Your apps" });
    for (const { a, n } of apps)
      rows.push({ kind: "app", id: `app:${a.id}`, title: a.name, count: n, mark: { app: a.id, name: a.name } });
  }
  rows.push({ kind: "connect", title: "Connect an app" });
  return rows;
}

/** The actions behind a group or app row, in the order the catalog gave them. */
export function submenuOf(m: PickIn, rowId: string): { title: string; mark: Mark; items: StepRow[] } | null {
  const v = view(m);
  const [kind, id] = [rowId.slice(0, rowId.indexOf(":")), rowId.slice(rowId.indexOf(":") + 1)];
  if (kind === "app") {
    const app = v.apps.find((a) => a.id === id);
    const items = v.steps.filter((x) => x.app?.id === id).map((x) => stepRow(x));
    return app && items.length > 0 ? { title: app.name, mark: { app: app.id, name: app.name }, items } : null;
  }
  if (kind === "group") {
    const g = [...INTENTS, MORE].find((x) => x.id === id);
    const items = v.steps.filter((x) => !x.app && x.group.id === id).map((x) => stepRow(x));
    return g && items.length > 0 ? { title: g.title, mark: { app: `vyre:${g.id}`, name: g.title }, items } : null;
  }
  return null;
}

// ---------------------------------------------------------------- the Connect an app sheet

export type SheetAction =
  | { kind: "setup"; label: "Set up" }
  | { kind: "ask"; label: string }
  | { kind: "describe"; label: "Describe it" }
  | { kind: "ready"; label: "Ready to use in steps" };

export interface SheetRow {
  id: string;
  name: string;
  /** The Vault item it comes from, where there is one. */
  item?: string;
  action: SheetAction;
}

export interface Sheet {
  sections: { head: string; rows: SheetRow[] }[];
}

const ask = (admin: string | undefined): SheetAction => ({
  kind: "ask",
  label: admin ? `Ask ${admin}` : "Ask an admin",
});

/**
 * In your Vault (he holds Use; Set up, or Ask when only an admin may clear it for the Assistant), Your Space has it (connected, he may not use it: Ask the admin), Another app.
 * A company key and a Vault item he may only view, or not see, are never listed.
 */
export function connectSheet(i: { apps: readonly PickApp[]; justAdded?: string | undefined }): Sheet {
  const ready: SheetRow[] = [];
  const vault: SheetRow[] = [];
  const space: SheetRow[] = [];
  for (const a of i.apps) {
    if (a.company) continue;
    if (usable(a)) {
      if (a.id === i.justAdded)
        ready.push({ id: a.id, name: a.name, action: { kind: "ready", label: "Ready to use in steps" } });
      continue;
    }
    if (a.connected) {
      space.push({ id: a.id, name: a.name, action: ask(a.admin) });
      continue;
    }
    if (a.vault?.use === "use") {
      vault.push({
        id: a.id,
        name: a.name,
        item: a.vault.item,
        action: a.vault.assistant === "admin" ? ask(a.admin) : { kind: "setup", label: "Set up" },
      });
    }
  }
  const sections: Sheet["sections"] = [];
  if (ready.length > 0) sections.push({ head: "Ready to use in steps", rows: ready });
  if (vault.length > 0) sections.push({ head: "In your Vault", rows: vault });
  if (space.length > 0) sections.push({ head: "Your Space has it", rows: space });
  sections.push({
    head: "Another app",
    rows: [{ id: "another", name: "Another app", action: { kind: "describe", label: "Describe it" } }],
  });
  return { sections };
}

export type AddChoice = { kind: "known"; id: string; label: string } | { kind: "custom"; label: string; name: string };

/** "Which app?": the known apps that match, and any other name as Add "Name". */
export function addAppChoices(query: string, known: readonly { id: string; name: string }[]): AddChoice[] {
  const q = query.trim();
  if (q === "") return [];
  const hits = known
    .map((k) => ({ k, s: score(q, k.name) }))
    .filter((h) => h.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 6)
    .map((h): AddChoice => ({ kind: "known", id: h.k.id, label: h.k.name }));
  const exact = known.some((k) => k.name.toLowerCase() === q.toLowerCase());
  return exact ? hits : [...hits, { kind: "custom", label: `Add “${q}”`, name: q }];
}
