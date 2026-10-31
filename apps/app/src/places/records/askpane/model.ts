// Ask Vyre inside Records: the pure part. Asking never leaves the tab. The place keeps what the person is doing (the open type, a type being made, the Record types page) as an
// `AskAbout`; the shell opens the assistant in a pane beside the page and tells it that, as ids and names only. No React here.

/** Where the person is when they ask. All parts are optional: `{}` is "in Records". */
export interface AskAbout {
  /** The record type open in the table, or being edited. */
  type?: string;
  /** The name typed in the New record type sheet, if one is open ("" while it is still empty). */
  making?: string;
  /** The Record types page is the open screen. */
  page?: "types";
}

/** The thread scope of the Records Ask pane: one thread per type, and one for the place. */
export const ASK_SCOPE = "records";
export const askScopeId = (a: AskAbout): string => (a.type ? `type:${a.type}` : a.page === "types" ? "types" : "place");

export interface AskPaneState { open: boolean; about: AskAbout }
export type AskPaneAction = { type: "ask"; about: AskAbout } | { type: "close" };
export const ASK_CLOSED: AskPaneState = { open: false, about: {} };

export function askPaneReduce(s: AskPaneState, a: AskPaneAction): AskPaneState {
  return a.type === "ask" ? { open: true, about: a.about } : { ...s, open: false };
}

/** What the assistant is told. The `focus-records` skill is the one that knows how to propose a record type or a link; nothing here is record content. */
export function askContext(a: AskAbout, title?: string): { title: string; open?: { type: string; id: string; title?: string }[]; actions: string[]; focus: string } {
  const open = a.type ? [{ type: "record_type", id: a.type, ...(title ? { title } : {}) }] : [];
  const where = a.making !== undefined ? (a.making ? `Making the record type ${a.making}` : "Making a record type") : a.page === "types" ? "Record types" : a.type ? `Records, ${title ?? a.type}` : "Records";
  return {
    title: where,
    ...(open.length ? { open } : {}),
    actions: ["propose a record type", "propose a field", "connect two record types", "preview with schema.diff, apply only after the person says Apply"],
    focus: "focus-records",
  };
}

/** The line at the top of the pane. */
export function askHint(a: AskAbout): string {
  if (a.making !== undefined) return a.making ? `Tell me how ${a.making} should work. I will show the change before it is made.` : "Say what you want to keep track of. I will show the change before it is made.";
  if (a.page === "types") return "Say what to add or change. I will show the change before it is made.";
  return "Ask about your records, or say what you want to keep track of.";
}

/**
 * The `askVyre` the Records data gives its buttons: it merges where the person is (the open type, the Record types page) with what the button knows (a type being made) and opens the pane
 * by dispatching, never by opening another place.
 */
export function makeAskVyre(dispatch: (a: AskPaneAction) => void, where: { type?: string | null | undefined; screen?: string | undefined }): (about: AskAbout) => void {
  return (about) => dispatch({ type: "ask", about: { ...(where.type ? { type: where.type } : {}), ...(where.screen === "records.types" ? { page: "types" as const } : {}), ...about } });
}
