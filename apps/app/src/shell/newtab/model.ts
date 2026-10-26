// The new-tab page (screen shell.new-tab, spec 3.0): the search field, and under it, while the field is empty, what a person starts from. The data is the Cmd-K data plus four small hooks.
import type { CmdKData } from "../cmdk/controller.ts";
import type { Hit } from "../cmdk/model.ts";

export type StartKind = "chat" | "agent" | "task" | "record" | "file" | "folder";

/** The Start tiles, in the prototype's order. */
export const START: readonly { kind: StartKind; label: string }[] = [
  { kind: "chat", label: "New chat" },
  { kind: "agent", label: "New agent" },
  { kind: "task", label: "New task" },
  { kind: "record", label: "New record" },
  { kind: "file", label: "New file" },
  { kind: "folder", label: "New folder" },
];

export interface NewTabData extends CmdKData {
  /** Agents and people to start a chat with, the faces under "Chat with". */
  faces(): readonly Hit[];
  /** Folders to open, listed last. */
  folders(): readonly Hit[];
  /** The record types the Space has, one chip each. */
  recordTypes(): readonly string[];
  start(kind: StartKind): void;
  /** Open Records on one type. */
  openType(type: string): void;
}

/** First names under the faces, as the prototype prints them. */
export const faceLabel = (h: Hit): string => (h.kind === "person" ? (h.title.split(" ")[0] ?? h.title) : h.title);
