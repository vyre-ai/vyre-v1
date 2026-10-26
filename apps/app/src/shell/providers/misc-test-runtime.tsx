// Test helper for the Automations, Vault and Settings provider tests: a ShellRuntime over a place sample's screens and calls.
import type { ScreenHooks } from "../../../../../client/src/index.ts";
import type { ShellRuntime } from "./runtime.tsx";

export function sampleRuntime(o: { screens: ScreenHooks; call(cap: string, input: unknown): Promise<unknown>; opened?: string[] }): ShellRuntime {
  const me = { id: "usr_irfad", name: "Irfad Imtiaz", kind: "person" as const };
  return {
    screens: o.screens, call: o.call, connection: { get: () => "online", subscribe: () => () => undefined },
    principals: { subscribe: () => () => undefined, getSnapshot: () => ({ status: "ready", data: [me] }) },
    recordTitle: () => undefined, me, clock: () => ({ now: Date.UTC(2025, 9, 24, 10, 0, 0), offsetMin: 0 }),
    space: { id: "northwind", kind: "team", name: "Northwind" }, assistant: { id: "agt_assistant", name: "Assistant" },
    aiConnected: true, calendarConnected: true,
    open: (t) => void o.opened?.push(t.screen ?? JSON.stringify(t.subject)), openUrl: () => undefined,
  };
}
