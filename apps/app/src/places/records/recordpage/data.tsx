// What the record page needs from the shell: live reads over the kept copy (the record, its type, the admin's layout, my page choices, completeness, the relationship map, history, versions,
// memory facts), the capability door for writes, who people are, and where a click goes. The shell fills it in; the screenshot mount and the tests pass their own.
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LiveQuery, QueryState } from "../../../../../../client/src/index.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { AskForInput } from "./askfor.ts";
import type { PickEntry } from "../../../../../../ui/src/PeoplePicker/index.tsx";

export type LiveCap =
  | "records.get" | "schema.describe" | "schema.layout.get" | "records.completeness" | "records.page_prefs.get" | "records.relations_map" | "records.history" | "records.activity" | "records.comments.list" | "records.versions" | "memory.find_by_subject" | "files.list" | "files.folder.get";

export interface RecordPageNav {
  /** A linked record opens as a tab on its own page. */
  openRecord(type: string, recordId: string): void;
  /** The record's own chat (every project has one; any record can have one) opens in Chats. */
  openChat(type: string, recordId: string): void;
  /** "Ask for these": the person's conversation opens in the Inbox with a message drafted for the fields the record lacks. Nothing is sent until they press Send. */
  askFor(input: AskForInput): void;
  /** The record's folder opens in Files. */
  openFiles(type: string, recordId: string): void;
  /** The place a fact or a note came from. */
  openSource(link: string): void;
  /** The Sync page of a record type that syncs from an app (the source chip opens it). */
  openSync?(type: string): void;
  /** A file opens in the viewer. */
  openFile?(fileId: string): void;
}

/** A file picked or dropped on the Files tab. */
export interface AttachFile { name: string; mime: string; file: { arrayBuffer(): Promise<ArrayBuffer>; type?: string } }

export interface RecordPageData {
  live<C extends LiveCap>(cap: C, input: CapMap[C]["in"]): LiveQuery<CapMap[C]["out"]>;
  /** One capability call as the signed-in person; rejects with the capability's error. */
  call(cap: string, input: unknown): Promise<unknown>;
  now(): number;
  nameOf(id: string): string;
  nav: RecordPageNav;
  /** You: your comments can be edited, and a mention of you is not a request to yourself. */
  me?: { id: string; name: string };
  /** The people and agents a comment can @mention (you left out). */
  mentionables?(): readonly PickEntry[];
  /** The Chat tab: this record's Ask pane drawn in place. The shell fills it in; where it cannot, the tab says so. */
  renderChat?(type: string, recordId: string): ReactElement;
  /** The Files tab: the record's own folder (its `folder` field, else the one made for it on the first attach) and storing files in it. Where the shell cannot, the tab lists the folder only. */
  files?: {
    folderOf(target: { type: string; recordId: string; title: string }): Promise<string | null>;
    /** Store the files in the record's folder, making it first when there is none. Resolves with the folder's id. */
    attach(files: readonly AttachFile[], target: { type: string; recordId: string; title: string }): Promise<string>;
  };
}

const Ctx = createContext<RecordPageData | null>(null);

export function RecordPageDataProvider({ value, children }: { value: RecordPageData; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOptionalPageData(): RecordPageData | null {
  return useContext(Ctx);
}

export function usePageData(): RecordPageData {
  const v = useContext(Ctx);
  if (!v) throw new Error("The record page needs a RecordPageDataProvider above it");
  return v;
}

/** A query that is not asked yet: loading, and nothing to subscribe to. */
const notYet: LiveQuery<never> = { subscribe: () => () => undefined, getSnapshot: () => NOT_YET };
const NOT_YET: QueryState<never> = { status: "loading" };

/** A live capability query; the input is compared by value, so an equal object keeps the subscription. With `enabled` false it is not asked yet and reads as loading. */
export function useLive<C extends LiveCap>(cap: C, input: CapMap[C]["in"], enabled = true): QueryState<CapMap[C]["out"]> {
  const { live } = usePageData();
  const key = JSON.stringify(input);
  const q = useMemo(() => (enabled ? live(cap, JSON.parse(key) as CapMap[C]["in"]) : (notYet as LiveQuery<CapMap[C]["out"]>)), [live, cap, key, enabled]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}
