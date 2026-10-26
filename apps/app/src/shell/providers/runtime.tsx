// What the shell hands every place: one runtime per open Space. It carries the client replica's screen hooks (every list a place draws is a live query over the kept copy),
// the capability caller, the connection state, the signed-in person, and one door for opening things. Places never open the network and never decide where a thing opens.
// The shell builds one runtime per Space and keeps it stable while that Space is open, so the providers below memoise on its identity.
import { createContext, useContext } from "react";
import type { ReactElement, ReactNode } from "react";
import type { HomeData } from "../../places/home/sections-a/data.tsx";

/** Where a click goes. The shell resolves a screen id (generated/screens.ts) or a subject to a place and a tab. */
export interface ShellTarget {
  screen?: string;
  subject?: { type: string; id: string };
  args?: Record<string, unknown>;
}

export type SpaceKind = "team" | "personal";

export interface ShellRuntime extends Omit<HomeData, "nav"> {
  space: { id: string; kind: SpaceKind; name: string };
  assistant: { id: string; name: string };
  /** Without an AI account the assistant is locked (the Ask box says so). Read at render, so a connection made in Settings shows at once. */
  readonly aiConnected: boolean;
  /** A Personal Space draws Today only when a calendar is connected on this computer. */
  calendarConnected: boolean;
  /** The modules the server defers whole (ruling 60); a place of one hides itself. Empty until the server says. */
  readonly deferredModules: ReadonlySet<string>;
  /** True when the server defers this capability (it answers "Not in this version yet"). */
  isDeferred(cap: string): boolean;
  open(target: ShellTarget): void;
  openUrl(url: string): void;
}

const Ctx = createContext<ShellRuntime | null>(null);

export function ShellRuntimeProvider({ value, children }: { value: ShellRuntime; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The runtime of the open Space, or null before the shell has opened the replica (a place then draws its loading frame). */
export function useOptionalShellRuntime(): ShellRuntime | null {
  return useContext(Ctx);
}

export function useShellRuntime(): ShellRuntime {
  const v = useContext(Ctx);
  if (!v) throw new Error("A place needs a ShellRuntimeProvider above it");
  return v;
}
