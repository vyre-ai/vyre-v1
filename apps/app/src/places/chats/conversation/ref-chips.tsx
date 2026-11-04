// A raw id in an agent's reply ("rec_01a1...") is never shown. The reply names the thing the way a person's # link does: its name, as a link that opens it beside the chat. Agents are told to write
// [[Name]] (or #Name) so this is rare; an id that slips through is resolved here (search.resolve, which only answers for what the reader may see) and drawn as the same link. Until it resolves, and
// when it cannot (gone, or not yours to open), the text says "a record" rather than the id.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { MarkdownBlocks, useStream } from "../../../../../../ui/src/stream/index.ts";
import type { RenderLink, StreamStore } from "../../../../../../ui/src/stream/index.ts";
import type { Block, Inline } from "../../../../../../ui/src/stream/markdown.ts";
import { LinkPiece, preview } from "./attachments.tsx";
import { resolveExternal } from "./external-ref.ts";
export { resolveExternal } from "./external-ref.ts";
import type { ConversationData } from "./model.ts";

type Data = Pick<ConversationData, "call" | "nav">;

/** The id prefixes agents are given, and the kind each one is. */
const KIND_OF: Record<string, string> = { rec: "record", file: "file", fil: "file", task: "task", tsk: "task", thr: "chat", chn: "channel", ch: "channel", usr: "person", note: "note", nte: "note" };
// an id written in the words, never one that is already part of an address (the part after a slash)
const ID = /(?<![/\w])(rec|file|fil|task|tsk|thr|chn|ch|usr|note|nte)_[0-9A-Za-z]{8,}\b/g;
/** The ids inside reference addresses: they need their names looked up like any other, and are never rewritten as text. */
const REF_ID = /ref\.vyre\.invalid\/[a-z]+\/((?:rec|file|fil|task|tsk|thr|chn|ch|usr|note|nte)_[0-9A-Za-z]{8,})/g;
/** What an id that could not be named is drawn as: nothing a person can read (a zero-width mark keeps the link from being empty). */
const HIDDEN = "\u200b";

const HOST = "https://ref.vyre.invalid/";
/** The form agents are told to write: [[Rivera Holdings|rec_01...]], the name, a bar, the id. The name is shown and the id never. The id is a Vyre id, or one from a tool result (a mail thread, a calendar event). */
const NAMED = /\[\[([^\]|\n]+)\|([^\]|\n]+)\]\]/g;
const VYRE_ID = /^(?:rec|file|fil|task|tsk|thr|chn|ch|usr|note|nte)_[0-9A-Za-z]{8,}$/;
const KEY_ONLY = /^[A-Z]{2,6}-\d{1,6}$/;
/** An id a tool handed back that is not a Vyre id: a mail thread (16 hex digits), a calendar event (cev_...), another service's. Needs a digit, or to be long hex, so a word is never taken for one. */
export const isExternalId = (id: string): boolean => !VYRE_ID.test(id) && !KEY_ONLY.test(id) && (/^cev_[0-9a-z]+$/i.test(id) || /^(?=.*\d)[0-9A-Za-z_-]{8,}$/.test(id) || /^[0-9a-f]{12,}$/i.test(id));
/** What kind of thing an external id is drawn as, before it is resolved: a calendar event when it says so, else a mail thread (the other kinds are tried when it does not resolve). */
export const guessKind = (id: string): string => (id.startsWith("cev_") ? "event" : "mail");

/** A task's short key, as people and agents write it in chat and commits: VY-142. Only a key the Space knows, that the reader may see, becomes a link. */
const KEY = /\b[A-Z]{2,6}-\d{1,6}\b/g;

export interface IdRef { id: string; kind: string }



/** The short keys a text names, once each, outside code. */
export function keysIn(text: string): string[] {
  return [...new Set(stripCode(text).match(KEY) ?? [])];
}

/** The text with each known key written as a link to its task. A word that only looks like a key stays as it is. */
export function withKeys(raw: string, known: ReadonlyMap<string, string>): string {
  // a model that writes the key where the name goes, [[VY-142|Title]], still reads as the key and the title
  const text = raw.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g).map((p, i) => (i % 2 === 1 ? p : p.replace(/\[\[([A-Z]{2,6}-\d{1,6})\|([^\]\n]+)\]\]/g, "$1 $2").replace(/\[\[([^\]|\n]+)\|[a-z]{2,5}_[0-9A-Za-z]{8,}\]\]/g, "$1"))).join("");
  if (known.size === 0) return text;
  return text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g).map((p, i) => (i % 2 === 1 ? p : p.replace(KEY, (key) => { const id = known.get(key); return id ? `[${key}](${HOST}task/${id})` : key; }))).join("");
}

/** The ids a text names, once each, outside code (a fenced or inline `code` span is the agent showing an id on purpose). */
export function idsIn(text: string): IdRef[] {
  const seen = new Map<string, IdRef>();
  const plain = stripCode(text).replace(NAMED, " ");
  for (const m of plain.matchAll(ID)) {
    const id = m[0]!;
    if (!seen.has(id)) seen.set(id, { id, kind: KIND_OF[m[1]!.toLowerCase()]! });
  }
  for (const m of plain.matchAll(REF_ID)) {
    const id = m[1]!;
    if (!seen.has(id)) seen.set(id, { id, kind: KIND_OF[id.split("_")[0]!.toLowerCase()]! });
  }
  return [...seen.values()];
}

/** The external ids ([[Name|id]] with an id from a tool result) a text names, once each, outside code. */
export function externalIds(text: string): string[] {
  const out = new Set<string>();
  for (const m of stripCode(text).matchAll(NAMED)) if (isExternalId(m[2]!.trim())) out.add(m[2]!.trim());
  return [...out];
}

const stripCode = (text: string): string => text.replace(/```[\s\S]*?(```|$)/g, " ").replace(/`[^`\n]*`/g, " ");

/**
 * The text with each id written as a link whose label is the name (or "a record" while it is not known). `ext` holds what an external id resolved to: its kind, or null when nothing opened it.
 * An external id that did not resolve (yet, or at all) leaves the Name as plain words: never the brackets and never nothing.
 */
export function withNames(text: string, names: ReadonlyMap<string, string | null>, ext: ReadonlyMap<string, string | null> = new Map()): string {
  const both = new RegExp(`${NAMED.source}|${ID.source}`, "g");
  const parts = text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g);
  const link = (label: string, id: string): string => `[${label.trim().replace(/[[\]()]/g, "")}](${HOST}${KIND_OF[id.split("_")[0]!.toLowerCase()]}/${id})`;
  return parts.map((p, i) => (i % 2 === 1 ? p : p.replace(both, (all, title?: string, namedId?: string, pre?: string) => {
    if (namedId !== undefined && title !== undefined) {
      const id = namedId.trim();
      if (VYRE_ID.test(id)) return link(title, id);
      if (KEY_ONLY.test(title.trim())) return all;
      const kind = isExternalId(id) ? ext.get(id) : null;
      return kind ? `[${title.trim().replace(/[[\]()]/g, "")}](${HOST}${kind}/${encodeURIComponent(id)})` : title.trim();
    }
    return link(names.get(all) ?? HIDDEN, all);
  }))).join("");
}

/** href of a chip link: the kind and the id, or null when it is some other link. */
export function refOfHref(href: string): IdRef | null {
  if (!href.startsWith(HOST)) return null;
  const [kind, id] = href.slice(HOST.length).split("/");
  return kind && id ? { kind, id: decodeURIComponent(id) } : null;
}

/** The body with ids resolved to names, and the renderer that draws those links as chips. Same body and no renderer when there is no id. */
export function useRefChips(body: string, data: Data | undefined): { body: string; renderLink: RenderLink | undefined } {
  const ids = useMemo(() => idsIn(body), [body]);
  const named = useMemo(() => new Map([...body.matchAll(NAMED)].filter((m) => VYRE_ID.test(m[2]!.trim()) || isExternalId(m[2]!.trim())).map((m) => [m[2]!.trim(), m[1]!.trim()] as const)), [body]);
  const externals = useMemo(() => externalIds(body), [body]);
  const [ext, setExt] = useState<ReadonlyMap<string, string | null>>(new Map());
  useEffect(() => {
    if (!data || externals.length === 0) return;
    let live = true;
    void Promise.all(externals.map(async (id) => [id, await resolveExternal(data, id)] as const)).then((rows) => { if (live) setExt(new Map(rows.map(([id, r]) => [id, r?.kind ?? null] as const))); });
    return () => { live = false; };
  }, [data, externals]);
  const [names, setNames] = useState<ReadonlyMap<string, string | null>>(new Map());
  useEffect(() => {
    if (!data || ids.length === 0) return;
    let live = true;
    void Promise.all(ids.map(async (r) => [r.id, (await preview(data, { ...r, title: "" }))?.title ?? null] as const)).then((rows) => { if (live) setNames(new Map(rows)); });
    return () => { live = false; };
  }, [data, ids]);
  const keys = useMemo(() => keysIn(body), [body]);
  const [known, setKnown] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    if (!data || keys.length === 0) return;
    let live = true;
    void Promise.all(keys.map(async (k) => [k, await data.call("tasks.by_key", { key: k }).then((o) => (o as { taskId: string | null }).taskId, () => null)] as const)).then((rows) => { if (live) setKnown(new Map(rows.filter((r): r is readonly [string, string] => r[1] !== null))); });
    return () => { live = false; };
  }, [data, keys]);
  const titled = useMemo(() => new Map([...known].map(([k, id]) => [id, k] as const)), [known]);
  const shown = useMemo(() => withKeys(ids.length === 0 && named.size === 0 && !body.includes("[[") ? body : withNames(body, names, ext), known), [body, ids, names, named, known, ext]);
  const renderLink = useMemo<RenderLink | undefined>(() => (!data || (ids.length === 0 && named.size === 0 && known.size === 0 && ext.size === 0) ? undefined : (href: string, children: ReactNode, key: number) => {
    const r = refOfHref(href);
    if (!r) return null;
    const title = names.get(r.id) ?? named.get(r.id) ?? titled.get(r.id);
    if (r.kind === "mail" || r.kind === "event") return title ? <LinkPiece key={key} r={{ ...r, title }} data={data} /> : <>{children}</>;
    // not resolved (yet, or not yours): the plain words, never the id and never a dead link
    return title ? <LinkPiece key={key} r={{ ...r, title }} data={data} /> : <>{children}</>;
  }), [data, ids, names, named, known, titled, ext]);
  return { body: shown, renderLink };
}

const mapInline = (items: readonly Inline[], f: (text: string) => Inline[]): Inline[] => {
  const merged: Inline[] = [];
  for (const n of items) {
    const last = merged[merged.length - 1];
    if (n.t === "text" && last?.t === "text") merged[merged.length - 1] = { t: "text", v: last.v + n.v };
    else merged.push(n);
  }
  return merged.flatMap((n): Inline[] => (n.t === "text" ? f(n.v) : n.t === "strong" || n.t === "em" ? [{ ...n, c: mapInline(n.c, f) }] : [n]));
};

/** Text nodes of parsed blocks with each id (or [[Name|id]]) cut out as a chip link. Code is never touched. */
export function refBlocks(blocks: readonly Block[], names: ReadonlyMap<string, string | null>, ext: ReadonlyMap<string, string | null> = new Map()): Block[] {
  const both = new RegExp(`${NAMED.source}|${ID.source}`, "g");
  const cut = (text: string): Inline[] => {
    const out: Inline[] = [];
    let at = 0;
    for (const m of text.matchAll(both)) {
      const i = m.index ?? 0;
      if (i > at) out.push({ t: "text", v: text.slice(at, i) });
      const id = (m[2] ?? m[0]).trim();
      if (m[2] !== undefined && !VYRE_ID.test(id)) {
        // an id from a tool result: its chip when it resolved, else the Name as plain words; a [[KEY|Title]] pair is the key and the title
        const k = KEY_ONLY.test((m[1] ?? "").trim()) ? null : isExternalId(id) ? ext.get(id) : null;
        out.push(k ? { t: "link", href: `${HOST}${k}/${encodeURIComponent(id)}`, c: [{ t: "text", v: (m[1] ?? "").trim() }] } : { t: "text", v: KEY_ONLY.test((m[1] ?? "").trim()) ? m[0] : (m[1] ?? "").trim() });
        at = i + m[0].length;
        continue;
      }
      const kind = KIND_OF[id.split("_")[0]!.toLowerCase()]!;
      out.push({ t: "link", href: `${HOST}${kind}/${id}`, c: [{ t: "text", v: m[1]?.trim() ?? names.get(id) ?? HIDDEN }] });
      at = i + m[0].length;
    }
    if (at < text.length) out.push({ t: "text", v: text.slice(at) });
    return out;
  };
  return blocks.map((b): Block => (b.kind === "p" || b.kind === "h" || b.kind === "quote" ? { ...b, inline: mapInline(b.inline, cut) } : b.kind === "ul" || b.kind === "ol" ? { ...b, items: b.items.map((it) => mapInline(it, cut)) } : b));
}

const textOf = (items: readonly Inline[]): string => items.map((n) => (n.t === "text" ? n.v : n.t === "strong" || n.t === "em" ? textOf(n.c) : "")).join("");
const blockText = (b: Block): string => (b.kind === "p" || b.kind === "h" || b.kind === "quote" ? textOf(b.inline) : b.kind === "ul" || b.kind === "ol" ? b.items.map(textOf).join("\n") : "");

/** A reply that is still being written (or an aside): the stream's text with ids drawn as names, the same as a saved reply. */
export function RefStreamText({ store, data }: { store: StreamStore; data: Data }) {
  const snap = useStream(store);
  const text = snap.blocks.map(blockText).join("\n");
  const ids = useMemo(() => idsIn(text), [text]);
  const [names, setNames] = useState<ReadonlyMap<string, string | null>>(new Map());
  useEffect(() => {
    const todo = ids.filter((r) => !names.has(r.id));
    if (todo.length === 0) return;
    let live = true;
    void Promise.all(todo.map(async (r) => [r.id, (await preview(data, { ...r, title: "" }))?.title ?? null] as const)).then((rows) => { if (live) setNames((cur) => new Map([...cur, ...rows])); });
    return () => { live = false; };
  }, [data, ids, names]);
  const externals = useMemo(() => externalIds(text), [text]);
  const [ext, setExt] = useState<ReadonlyMap<string, string | null>>(new Map());
  useEffect(() => {
    const todo = externals.filter((id) => !ext.has(id));
    if (todo.length === 0) return;
    let live = true;
    void Promise.all(todo.map(async (id) => [id, (await resolveExternal(data, id))?.kind ?? null] as const)).then((rows) => { if (live) setExt((cur) => new Map([...cur, ...rows])); });
    return () => { live = false; };
  }, [data, externals, ext]);
  const blocks = useMemo(() => (text.includes("_") || text.includes("[[") ? refBlocks(snap.blocks, names, ext) : snap.blocks), [snap.blocks, names, text, ext]);
  const renderLink = useMemo<RenderLink>(() => (href: string, children: ReactNode, key: number) => {
    const r = refOfHref(href);
    if (!r) return null;
    const title = names.get(r.id) ?? (typeof children === "string" ? children : undefined);
    return title ? <LinkPiece key={key} r={{ ...r, title }} data={data} /> : <>{children}</>;
  }, [data, names]);
  return <MarkdownBlocks blocks={blocks} streaming={!snap.done} renderLink={renderLink} />;
}
