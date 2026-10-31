// What the composer's # and [[ ]] menus offer: records, files, folders and channels the person can reach, found as they type. The composer filters a list it is given, so this keeps one list per kind
// and refills it from the Space's search (search.query, within the person's access) a moment after the words change. Each item keeps its id (`ref`), so a pick is sent as the thing itself.
import { useEffect, useRef, useState } from "react";
import type { ComposerLists, ComposerPreview, ListItem, PopupItem } from "../../../../../../ui/src/Composer/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ConversationData } from "./data.tsx";

export interface Suggested { records: ListItem[]; files: ListItem[]; folders: ListItem[]; channels: ListItem[]; chats?: ListItem[]; automations?: ListItem[]; projects?: ListItem[] }
export const NONE: Suggested = { records: [], files: [], folders: [], channels: [] };

type Hit = CapMap["search.query"]["out"]["hits"][number];

export function itemOf(h: Hit): { group: keyof Suggested; item: ListItem } | null {
  if (h.kind === "record") return { group: "records", item: { t: h.title, ...(h.recordType ? { s: h.recordType, data: { type: h.recordType } } : {}), kind: "Record", ref: h.id } };
  if (h.kind === "file") return { group: "files", item: { t: h.title, ...(h.path ? { s: h.path } : {}), kind: "File", ref: h.id } };
  if (h.kind === "channel") return { group: "channels", item: { t: h.title, kind: "Channel", ref: h.id } };
  if (h.kind === "chat") return { group: "chats", item: { t: h.title, ...(h.snippet ? { s: h.snippet } : {}), kind: "Chat", ref: h.id } };
  if (h.kind === "automation") return { group: "automations", item: { t: h.title, ...(h.snippet ? { s: h.snippet } : {}), kind: "Automation", ref: h.id } };
  return null;
}

/** The open trigger at the end of the typed text and the words after it, when it is one of the menus this fills. */
export function openQuery(text: string): { ch: "#" | "[["; q: string } | null {
  // the same two patterns as the composer's detectTrigger, kept here so the menu code does not pull the composer in with the chat page
  const link = /\[\[([^\]\n]*)$/.exec(text);
  if (link) return { ch: "[[", q: (link[1] ?? "").trim() };
  const hash = /(^|\s)#([^\s@#/]*)$/.exec(text);
  return hash ? { ch: "#", q: (hash[2] ?? "").trim() } : null;
}

export const DEBOUNCE_MS = 150;

export async function fetchSuggestions(data: Pick<ConversationData, "call">, ch: "#" | "[[", q: string): Promise<Suggested> {
  const types = ch === "[[" ? ["record"] : ["record", "file", "channel", "chat", "automation"];
  const out: Suggested = ch === "[[" ? { records: [], files: [], folders: [], channels: [] } : { records: [], files: [], folders: [], channels: [], chats: [], automations: [], projects: [] };
  const hits = q === ""
    ? ((await data.call("search.recent.list", { types, limit: 12 })) as CapMap["search.recent.list"]["out"]).hits
    : ((await data.call("search.query", { q, types, limit: 12 })) as CapMap["search.query"]["out"]).hits;
  for (const h of hits) { const m = itemOf(h); if (m) (out[m.group] ??= []).push(m.item); }
  if (ch === "#") {
    try {
      const p = (await data.call("projects.list", { mine: true, limit: 50 })) as CapMap["projects.list"]["out"];
      const want = q.toLowerCase();
      out.projects = p.projects.filter((x) => want === "" || x.title.toLowerCase().includes(want)).slice(0, 12)
        .map((x) => ({ t: x.title, s: `Project \u00b7 ${x.openTasks} open ${x.openTasks === 1 ? "task" : "tasks"}`, kind: "Project", ref: x.projectId, data: { status: x.status, ...(x.due ? { due: String(x.due) } : {}) } }));
    } catch { /* projects are an extra */ }
    try {
      const f = (await data.call("files.folder.search", { q, limit: 6 })) as CapMap["files.folder.search"]["out"];
      out.folders = f.folders.map((x) => ({ t: x.name, s: x.path, kind: "Folder", ref: x.folderId }));
    } catch { /* folders are an extra; the rest still shows */ }
  }
  return out;
}

/** The lists for the composer. Empty until a # or [[ is typed; then filled from search, and kept while the person keeps typing. */
export function useSuggest(data: ConversationData, text: string): Suggested {
  const [found, setFound] = useState<Suggested>(NONE);
  const seq = useRef(0);
  const open = openQuery(text);
  const ch = open?.ch, q = open?.q;
  useEffect(() => {
    if (ch === undefined || q === undefined) return undefined;
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      void fetchSuggestions(data, ch, q).then((s) => { if (mine === seq.current) setFound(s); }, () => undefined);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [data, ch, q]);
  return found;
}

/** The composer's # search, as the composer asks for it. */
export function composerSuggest(data: Pick<ConversationData, "call">): (ch: "#" | "[[", q: string) => Promise<ComposerLists> {
  return (ch, q) => fetchSuggestions(data, ch, q);
}

const dateOf = (ms: number): string => { const d = new Date(ms); return `${d.getDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]}`; };
const sizeOf = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const show = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map((x) => show(x)).filter(Boolean).join(", ") || null;
  const o = v as { name?: unknown; title?: unknown; label?: unknown };
  return show(o.name ?? o.title ?? o.label ?? null);
};
const label = (k: string): string => { const w = k.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim(); return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); };

/** The # preview pane: a record's first key fields (records.get), a file's size, editor and last change (files.get), a project's status. Null when it cannot be read. */
export async function previewOf(data: Pick<ConversationData, "call" | "nameOf">, item: PopupItem): Promise<ComposerPreview | null> {
  if (item.ref === undefined) return null;
  if (item.kind === "Record" && item.data?.["type"]) {
    const out = (await data.call("records.get", { type: item.data["type"], recordId: item.ref })) as CapMap["records.get"]["out"];
    const fields: [string, string][] = [];
    for (const [k, v] of Object.entries(out.record.fields ?? {})) {
      const t = show(v);
      if (t === null || /^(name|title|id)$/i.test(k)) continue;
      fields.push([label(k), t]);
      if (fields.length === 4) break;
    }
    return { sub: item.data["type"], fields };
  }
  if (item.kind === "File") {
    const out = (await data.call("files.get", { fileId: item.ref })) as CapMap["files.get"]["out"];
    return { sub: item.note ?? "", fields: [["Size", sizeOf(out.file.size)], ["Edited", dateOf(out.file.updatedAt)], ["By", data.nameOf(out.file.updatedBy)]] };
  }
  if (item.kind === "Project") {
    return { fields: [["Status", item.data?.["status"] ?? ""], ...(item.data?.["due"] ? [["Due", dateOf(Number(item.data["due"]))] as [string, string]] : [])].filter(([, v]) => v !== "") as [string, string][] };
  }
  return item.note ? { sub: item.note, fields: [] } : null;
}
