// A raw id in an agent's reply ("rec_01a1...") is never shown. The reply names the thing the way a person's # link does: its name, as a link that opens it beside the chat. Agents are told to write
// [[Name]] (or #Name) so this is rare; an id that slips through is resolved here (search.resolve, which only answers for what the reader may see) and drawn as the same link. Until it resolves, and
// when it cannot (gone, or not yours to open), the text says "a record" rather than the id.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { RenderLink } from "../../../../../../ui/src/stream/index.ts";
import { LinkPiece, preview } from "./attachments.tsx";
import type { ConversationData } from "./model.ts";

type Data = Pick<ConversationData, "call" | "nav">;

/** The id prefixes agents are given, and the kind each one is. */
const KIND_OF: Record<string, string> = { rec: "record", file: "file", task: "task", tsk: "task", thr: "chat", chn: "channel", ch: "channel" };
const ID = /\b(rec|file|task|tsk|thr|chn|ch)_[0-9A-Za-z]{8,}\b/g;
const NAME_OF: Record<string, string> = { record: "a record", file: "a file", task: "a task", chat: "a chat", channel: "a channel" };
const HOST = "https://ref.vyre.invalid/";
/** The form agents are told to write: [[Rivera Holdings|rec_01...]], the name, a bar, the id. The name is shown and the id never. */
const NAMED = /\[\[([^\]|\n]+)\|((?:rec|file|task|tsk|thr|chn|ch)_[0-9A-Za-z]{8,})\]\]/g;

export interface IdRef { id: string; kind: string }

/** The ids a text names, once each, outside code (a fenced or inline `code` span is the agent showing an id on purpose). */
export function idsIn(text: string): IdRef[] {
  const seen = new Map<string, IdRef>();
  for (const m of stripCode(text).replace(NAMED, " ").matchAll(ID)) {
    const id = m[0]!;
    if (!seen.has(id)) seen.set(id, { id, kind: KIND_OF[m[1]!.toLowerCase()]! });
  }
  return [...seen.values()];
}

const stripCode = (text: string): string => text.replace(/```[\s\S]*?(```|$)/g, " ").replace(/`[^`\n]*`/g, " ");

/** The text with each id written as a link whose label is the name (or "a record" while it is not known). */
export function withNames(text: string, names: ReadonlyMap<string, string | null>): string {
  const both = new RegExp(`${NAMED.source}|${ID.source}`, "g");
  const parts = text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g);
  const link = (label: string, id: string): string => `[${label.trim().replace(/[[\]()]/g, "")}](${HOST}${KIND_OF[id.split("_")[0]!.toLowerCase()]}/${id})`;
  return parts.map((p, i) => (i % 2 === 1 ? p : p.replace(both, (all, title?: string, namedId?: string, pre?: string) => {
    if (namedId !== undefined && title !== undefined) return link(title, namedId);
    const kind = KIND_OF[(pre ?? "").toLowerCase()]!;
    return link(names.get(all) ?? NAME_OF[kind] ?? "a link", all);
  }))).join("");
}

/** href of a chip link: the kind and the id, or null when it is some other link. */
export function refOfHref(href: string): IdRef | null {
  if (!href.startsWith(HOST)) return null;
  const [kind, id] = href.slice(HOST.length).split("/");
  return kind && id ? { kind, id } : null;
}

/** The body with ids resolved to names, and the renderer that draws those links as chips. Same body and no renderer when there is no id. */
export function useRefChips(body: string, data: Data | undefined): { body: string; renderLink: RenderLink | undefined } {
  const ids = useMemo(() => idsIn(body), [body]);
  const named = useMemo(() => new Map([...body.matchAll(NAMED)].map((m) => [m[2]!, m[1]!.trim()] as const)), [body]);
  const [names, setNames] = useState<ReadonlyMap<string, string | null>>(new Map());
  useEffect(() => {
    if (!data || ids.length === 0) return;
    let live = true;
    void Promise.all(ids.map(async (r) => [r.id, (await preview(data, { ...r, title: "" }))?.title ?? null] as const)).then((rows) => { if (live) setNames(new Map(rows)); });
    return () => { live = false; };
  }, [data, ids]);
  const shown = useMemo(() => (ids.length === 0 && named.size === 0 ? body : withNames(body, names)), [body, ids, names, named]);
  const renderLink = useMemo<RenderLink | undefined>(() => (!data || (ids.length === 0 && named.size === 0) ? undefined : (href: string, children: ReactNode, key: number) => {
    const r = refOfHref(href);
    if (!r) return null;
    const title = names.get(r.id) ?? named.get(r.id);
    // not resolved (yet, or not yours): the plain words, never the id and never a dead link
    return title ? <LinkPiece key={key} r={{ ...r, title }} data={data} /> : <>{children}</>;
  }), [data, ids, names, named]);
  return { body: shown, renderLink };
}
