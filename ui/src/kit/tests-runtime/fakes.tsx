// Shared fakes for the kit runtime tests: hooks over fixed data, an env, and a def.
import type { LiveQuery, ScreenHooks } from "../../../../client/src/index.ts";
import type { KitScreenDef } from "../types.ts";
import type { KitEnv } from "../runtime/env.ts";

export function fakeHooks(data: Record<string, unknown>, loading: readonly string[] = []): ScreenHooks {
  return {
    query(_screenId, name): LiveQuery<unknown> {
      const snap = loading.includes(name) || !(name in data) ? { status: "loading" as const } : { status: "ready" as const, data: data[name] };
      return { subscribe: () => () => {}, getSnapshot: () => snap };
    },
  };
}

export function fakeEnv(over: Partial<KitEnv> & { data?: Record<string, unknown>; loading?: readonly string[] } = {}): KitEnv & { invoked: { action: unknown; input: unknown }[] } {
  const invoked: { action: unknown; input: unknown }[] = [];
  const { data = {}, loading = [], ...rest } = over;
  return {
    hooks: fakeHooks(data, loading),
    online: true,
    invoke: (action, input) => { invoked.push({ action, input }); },
    ...rest,
    invoked,
  };
}

export const listDef: KitScreenDef = {
  id: "demo.list",
  place: "records",
  slot: "main",
  queries: { people: { cap: "records.list", input: { q: "/state/q" }, live: true } },
  actions: {
    open: { cap: "records.open", input: { id: "/row/id" } },
    remove: { cap: "records.delete", input: { id: "/row/id" }, confirm: "Delete this record?" },
  },
  states: {
    empty: { line: "No people yet", primary: "Add a person" },
    offline: { line: "Offline" },
    error: { line: "People did not load", primary: "Try again" },
  },
  layout: {
    t: "stack",
    children: [
      { t: "text", value: "People", style: "heading" },
      {
        t: "list",
        bind: "/queries/people",
        empty: "No matches",
        row: { t: "row", children: [{ t: "text", value: "{/row/name}" }, { t: "text", value: "{/row/company}", style: "muted" }, { t: "button", label: "Open", action: "open" }] },
      },
    ],
  },
  menus: [{ target: "/queries/people", items: [{ label: "Open", icon: "open", action: "open" }, { label: "Delete", icon: "trash", action: "remove", when: "/row/id" }] }],
  keys: [{ combo: "mod+backspace", action: "remove" }],
  perf: { firstPaintMs: 50, completeMs: 100 },
};

export const people = [
  { id: "p1", name: "Maya Chen", company: "Northwind", title: "Maya Chen", note: "Northwind" },
  { id: "p2", name: "Omar Haddad", company: "Harbor Legal", title: "Omar Haddad", note: "Harbor Legal" },
  { id: "p3", name: "Lena Voss", company: "Voss & Park", title: "Lena Voss", note: "Voss & Park" },
];
