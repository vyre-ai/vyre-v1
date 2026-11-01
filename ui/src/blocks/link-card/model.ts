// The link card (rc.9): one small block that says "this happened, and here is where it went" with a link to the other place. A message that became a task, a decision that became a fact, an agent's
// summary with buttons: all of them are this block, so a card looks the same wherever work moved from and to, and every card links both ways. Pure: no drawing here.
export const LINK_CARD = "link_card";

/** What the card links to; the host opens it (a task, a record, a file, a fact, a thread). */
export interface LinkTarget { type: string; id: string }

export interface LinkCardData {
  /** What kind of thing the card is about: the host picks its glyph (task, fact, file, record, summary, thread). */
  icon: string;
  /** The verb, said as it happened: "Task created", "Remembered", "Summary". */
  lead: string;
  /** The thing's own name: the task title, the fact, the file name. Opens the target when there is one. */
  title: string;
  /** A person or agent id the card names ("assigned to Maya"); the host turns it into a name. */
  who?: string;
  target?: LinkTarget;
  /** More than a line: an agent's summary. Cards with a body or actions draw as a card, the rest as one line. */
  body?: string;
  /** Buttons under the body; the host knows what each key does (make a task, remember). */
  /** `cap` and `input` make a button do something by itself: the host calls that capability as the person (the Gate still holds what leaves Vyre). A button with no `cap` only reports its key. */
  actions?: { key: string; label: string; cap?: string; input?: Record<string, unknown> }[];
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);

/** The card a block holds, or null when it is not one (or is too broken to draw). */
export function linkCardOf(b: { type: string; data: unknown }): LinkCardData | null {
  if (b.type !== LINK_CARD || typeof b.data !== "object" || b.data === null) return null;
  const d = b.data as Record<string, unknown>;
  const lead = str(d["lead"]), title = str(d["title"]);
  if (!lead || !title) return null;
  const t = d["target"] as Record<string, unknown> | undefined;
  const type = str(t?.["type"]), id = str(t?.["id"]);
  const who = str(d["who"]), body = str(d["body"]);
  const actions = Array.isArray(d["actions"])
    ? d["actions"].flatMap((a): NonNullable<LinkCardData["actions"]> => {
      const x = a as Record<string, unknown>; const key = str(x["key"]), label = str(x["label"]), cap = str(x["cap"]);
      const input = typeof x["input"] === "object" && x["input"] !== null && !Array.isArray(x["input"]) ? (x["input"] as Record<string, unknown>) : undefined;
      return key && label ? [{ key, label, ...(cap ? { cap } : {}), ...(cap && input ? { input } : {}) }] : [];
    }).slice(0, 4)
    : [];
  return {
    icon: str(d["icon"]) ?? "thread", lead, title,
    ...(who ? { who } : {}), ...(type && id ? { target: { type, id } } : {}), ...(body ? { body: body.slice(0, 2000) } : {}), ...(actions.length ? { actions } : {}),
  };
}

export const isLinkCard = (b: { type: string; data: unknown }): boolean => linkCardOf(b) !== null;

/** The one line: "Task created, assigned to Maya". `nameOf` turns the id into a name. */
export function linkCardLine(d: LinkCardData, nameOf: (id: string) => string): string {
  return d.who ? `${d.lead}, assigned to ${nameOf(d.who)}` : d.lead;
}

/** A card that is more than a line: it has words under it or buttons. */
export const isFullCard = (d: LinkCardData): boolean => d.body !== undefined || (d.actions?.length ?? 0) > 0;

/** The block a handler writes into a thread: the one place the shape is built, so every module's card is the same. */
export function linkCardBlock(id: string, traceId: string, d: LinkCardData): { type: string; v: number; id: string; data: LinkCardData; state: string; traceId: string } {
  return { type: LINK_CARD, v: 1, id, data: d, state: "done", traceId };
}
