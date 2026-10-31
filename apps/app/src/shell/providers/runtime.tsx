import type{SpaceDef}from'../spaces/model.ts';
import type {RecordsPreviewTicket,RecordsPreviewReader} from "../../../../../client/src/gateway/records-preview.ts";
// What the shell hands every place: one runtime per open Space. It carries the client replica's screen hooks (every list a place draws is a live query over the kept copy),
// the capability caller, the connection state, the signed-in person, and one door for opening things. Places never open the network and never decide where a thing opens.
// The shell builds one runtime per Space and keeps it stable while that Space is open, so the providers below memoise on its identity.
import { createContext, useContext } from "react";
import type { ReactElement, ReactNode } from "react";
import type { HomeData } from "../../places/home/sections-a/data.tsx";
import { setAssistantId } from "../../../../../ui/src/Avatar/assistant.ts";
import type { TurnStreams } from "../session/turn-streams.ts";

/** Where a click goes. The shell resolves a screen id (generated/screens.ts) or a subject to a place and a tab. */
export interface ShellTarget {
  screen?: string;
  subject?: { type: string; id: string };
  args?: Record<string, unknown>;
  /** Open it in a tab behind the one the person is in (Cmd-click, middle click). */
  background?: boolean;
}

export type SpaceKind = "team" | "personal";

export interface ShellRuntime extends Omit<HomeData, "nav"> {
  createRecordsPreview?(ticket:RecordsPreviewTicket):RecordsPreviewReader;
  space: { id: string; kind: SpaceKind; name: string };
  /** The Space's address, e.g. https://northwind.vyre.run. A desktop app loads from its own scheme (tauri://), so a path the Space serves (a live view) needs this in front of it. */
  baseUrl?: string;
  knownSpaces?: readonly SpaceDef[];
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
  /** Agent replies as they are written, from the live socket. Absent where there is no live link (tests, a replica-only shell). */
  turns?: TurnStreams;
  /** Slash commands that plugins add to chat (name, one line, what to run). Absent until a plugin offers any. */
  pluginCommands?(): readonly { name: string; description: string; pluginId?: string; prompt?: string; run?(arg: string): Promise<string | void> }[];
  /** Run a capability in another Space this device is signed in to, as the same person. Absent where there is only one Space. */
  callIn?(spaceId: string, cap: string, input: unknown): Promise<unknown>;
  /** Put bytes at a one-time upload address from files.upload_url, signed in as the person. */
  putBlob?(path: string, bytes: Uint8Array): Promise<void>;
  /** Open the person's own Mine vault key on this computer with their password, in place (no sign-out). Absent where there is no live Space. Rejects with a sentence the page can show. */
  unlockVault?(password: string): Promise<void>;
}

const Ctx = createContext<ShellRuntime | null>(null);

export function ShellRuntimeProvider({ value, children }: { value: ShellRuntime; children: ReactNode }): ReactElement {
  // The assistant wears the Vyre mark in every face below; say which agent it is before they draw.
  setAssistantId(value.assistant.id);
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
