// Mount for TASKCONFLICT_01 (lane l-learn2): two people edited one task. The page is the real task page over a runtime whose tasks.update refuses a save made on version 4 (the task is on 5, changed by Sara)
// with what the task holds now, exactly as the server does. After the page has drawn, the mount makes the edits a person would: a new due date and a new priority from the Details menus, then a new title.
// Each is refused, and the card shows each field's value beside the current one. ?view=conflict shows the card with the picks Keep mine, Keep mine, Use Sara's; ?view=saved shows the line after Save; ?view=long makes the description a long text, so the card shows only the part that differs, with Show all. The edits are the Due and Priority menus (a wide window), the title and the description.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { createThemeController } from "../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../ui/src/theme/index.ts";
import { TaskDetail } from "../../../apps/app/src/places/chats/tasks/TaskDetail.tsx";

export const title = "Tasks: two people edited one task";

const NOW = Date.UTC(2026, 10, 3, 9, 30);
const DAY = 86_400_000;
const ME = "usr_irfad";
const PEOPLE = [{ id: ME, name: "Irfad Imtiaz", kind: "person" }, { id: "usr_sara", name: "Sara Khan", kind: "person" }, { id: "agt_mira", name: "Mira", kind: "agent" }];
const OLD_BRIEF = "Short note to Dana covering the new term and what changes. Keep pricing out until Sara signs off.";
const SARA_BRIEF = "Short note to Dana covering the new term. Pricing stays out until Sara signs off.";
const MINE_BRIEF = "Short note to Dana covering the new term and what changes. Pricing goes in as a table at the end.";
const LONG_BASE = "Note to Dana covering the new twelve month term, the retainer, the two filing dates and the fee schedule, with each change from last year's engagement letter listed on its own line so she can check them one by one before she signs. ";
const SARA_LONG = `${LONG_BASE}Pricing stays out until Sara has signed off the figures.`;
const MINE_LONG = `${LONG_BASE}Pricing goes in as a table at the end, after Sara signed off the figures.`;
type Row = Record<string, unknown>;
const TASK: Row = {
  id: "tsk_1", key: "NW-47", kind: "work", state: "doing", blocked: false, blocks: [], actions: [], labels: [], dependsOn: [], fileIds: [], followers: [ME, "usr_sara"], reviewLoops: 0,
  title: "Draft the renewal note", assigned: { kind: "agent", id: "agt_mira" }, reviewer: { kind: "person", id: ME }, createdBy: ME, version: 4, due: NOW + 3 * DAY, priority: "high",
  workingNotes: { brief: OLD_BRIEF }, createdAt: NOW - 2 * DAY, updatedAt: NOW - 3_600_000,
};
const CURRENT: Row = { title: "Draft the renewal note", due: NOW + 3 * DAY, priority: "high", brief: SARA_BRIEF };

interface RootLike { setAttribute(name: string, value: string): void; style: { setProperty(name: string, value: string): void; removeProperty(name: string): void } }
type Pick1 = { click?: () => void; focus?: () => void; blur?: () => void; textContent?: string | null; value?: string; dispatchEvent?: (e: unknown) => boolean };
type Doc = { execCommand?(cmd: string, ui?: boolean, value?: string): boolean; querySelector(s: string): Pick1 | null; querySelectorAll(s: string): ArrayLike<Pick1>; documentElement?: RootLike };

function runtime(): unknown {
  const kept = new Map<string, unknown>();
  const live = (data: unknown, key = JSON.stringify(data)) => { let snap = kept.get(key); if (!snap) { snap = { status: "ready", data }; kept.set(key, snap); } return { subscribe: () => () => undefined, getSnapshot: () => snap }; };
  const stale = (input: Row): Error => {
    const current: Row = {};
    for (const k of Object.keys(input)) if (k in CURRENT) current[k] = CURRENT[k];
    return Object.assign(new Error("This task changed while you were editing it."), { name: "CapError", code: "validation.precondition_failed", traceId: "tr", status: 409, details: { reason: "stale_version", version: 5, updatedAt: NOW, current, by: "usr_sara" } });
  };
  const call = async (cap: string, input: Row): Promise<unknown> => {
    if (cap === "tasks.index") return { rev: "r1", unchanged: false, rows: [], doneThisWeek: 0, total: 0 };
    if (cap === "tasks.update") { if (input.expectedVersion === 5) return { task: { ...TASK, ...input, workingNotes: { brief: String(CURRENT.brief) }, version: 6, updatedAt: NOW + 1000 } }; throw stale(input); }
    if (cap === "tasks.working_notes.set") {
      if (input.expectedFrom !== undefined && input.expectedFrom !== CURRENT.brief) throw stale({ brief: CURRENT.brief });
      CURRENT.brief = String(input.value);
      return { task: { ...TASK, workingNotes: { brief: CURRENT.brief }, version: 6, updatedAt: NOW + 1000 } };
    }
    if (cap === "projects.list") return { projects: [] };
    if (cap === "schema.types.get") return { type: { fields: [] } };
    if (cap === "access.groups.list") return { groups: [] };
    if (cap === "access.roles.list") return { roles: [] };
    return {};
  };
  const screens = {
    query(screen: string, name: string, state: Row) {
      if (screen === "tasks.page" && name === "task") { const id = (state?.route as Row | undefined)?.taskId; return live({ task: id === "tsk_1" ? TASK : undefined }); }
      if (screen === "tasks.page" && name === "activity") return live({ entries: [], total: 0 });
      return live({});
    },
  };
  return {
    screens, call, principals: live(PEOPLE), me: { id: ME, name: "Irfad Imtiaz" }, assistant: { id: "agt_assistant", name: "Assistant" }, clock: () => ({ now: NOW, offsetMin: 300 }),
    recordTitle: () => undefined, open: () => undefined, openUrl: () => undefined, space: { id: "northwind", kind: "team", name: "Northwind" }, aiConnected: true, calendarConnected: true,
    deferredModules: new Set<string>(), isDeferred: () => false,
  };
}

export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  return q ? <Page view={q.get("view") ?? "conflict"} skin={q.get("skin") ?? "paper"} /> : <View testID="taskconflict-wait" style={StyleSheet.absoluteFill} />;
}

function Page({ view, skin }: { view: string; skin: string }): ReactNode {
  useMemo(() => {
    const root = (globalThis as { document?: Doc }).document?.documentElement;
    const themeRoot: ThemeRoot = { setAttribute: (n, v) => { root?.setAttribute(n, v); }, setProperty: (n, v) => { root?.style.setProperty(n, v); }, removeProperty: (n) => { root?.style.removeProperty(n); } };
    return createThemeController({ personId: "irfad", spaceId: "nw", spaceSkin: { nw: skin }, prefersDark: skin === "graphite", root: themeRoot, storage: null });
  }, [skin]);
  const rt = useMemo(() => { if (view === "long") { CURRENT.brief = SARA_LONG; (TASK.workingNotes as Row).brief = LONG_BASE; } return runtime() as never; }, [view]);
  // the edits a person would make, one after the other, once the page has drawn
  useEffect(() => {
    const d = (globalThis as { document?: Doc }).document;
    if (!d) return undefined;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, f: () => void): void => { timers.push(setTimeout(f, ms)); };
    const item = (text: string): Pick1 | undefined => Array.from(d.querySelectorAll("[role='menuitem']")).find((e) => e.textContent?.trim() === text);
    const pick = (row: string, word: string): void => { d.querySelector(`[data-testid='${row}']`)?.click?.(); at(250, () => item(word)?.click?.()); };
    const wide = ((globalThis as { innerWidth?: number }).innerWidth ?? 1440) >= 980;
    const type = (testId: string, tag: "HTMLTextAreaElement" | "HTMLInputElement", text: string): void => {
      const el = d.querySelector(`[data-testid='${testId}']`);
      if (!el) return;
      el.focus?.();
      const proto = (globalThis as unknown as Record<string, { prototype: object }>)[tag]!.prototype;
      (Object.getOwnPropertyDescriptor(proto, "value")?.set as ((v: string) => void) | undefined)?.call(el, text);
      el.dispatchEvent?.(new (globalThis as unknown as { Event: new (t: string, i: object) => unknown }).Event("input", { bubbles: true }));
      el.blur?.();
    };
    if (wide) { at(500, () => d.querySelector("[data-testid='task-rail-toggle']")?.click?.()); at(1000, () => pick("rail-due", "Tomorrow")); at(1700, () => pick("rail-priority", "Urgent")); }
    at(2500, () => type("task-title", "HTMLTextAreaElement", "Draft the Northwind renewal note"));
    at(3000, () => d.querySelector("[data-testid='task-brief']")?.click?.());
    // the brief is a rich editor now (a contenteditable page, not a text area): a person selects the text and types over it
    const typeRich = (text: string): void => {
      const el = d.querySelector("[data-testid='markdown-editor-page']");
      if (!el) return;
      el.focus?.();
      d.execCommand?.("selectAll");
      d.execCommand?.("insertText", false, text);
      at(300, () => el.blur?.());
    };
    at(3400, () => typeRich(view === "long" ? MINE_LONG : MINE_BRIEF));
    const takeTheirs = (): void => { (d.querySelector("[data-testid='task-conflict-current-priority']") ?? d.querySelector("[data-testid='task-conflict-current-title']"))?.click?.(); };
    if (view === "conflict" || view === "long") at(4300, takeTheirs);
    if (view === "saved") { at(4300, takeTheirs); at(4800, () => d.querySelector("[data-testid='task-conflict-save']")?.click?.()); }
    return () => timers.forEach(clearTimeout);
  }, [view]);
  const none = (): void => undefined;
  return (
    <View testID="taskconflict-mount" style={[StyleSheet.absoluteFill, { backgroundColor: "var(--win)" as string }]}>
      <TaskDetail rt={rt} taskId="tsk_1" conversationFor={() => { throw new Error("no thread in this sample"); }} openTask={none} openAgent={none} openChat={none} />
    </View>
  );
}
