// What the composer's # and [[ ]] menus offer: records, files, folders and channels the person can reach, found as they type. The composer filters a list it is given, so this keeps one list per kind
// and refills it from the Space's search (search.query, within the person's access) a moment after the words change. Each item keeps its id (`ref`), so a pick is sent as the thing itself.
import { useEffect, useRef, useState } from "react";
import type { ListItem } from "../../../../../../ui/src/Composer/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ConversationData } from "./data.tsx";

export interface Suggested { records: ListItem[]; files: ListItem[]; folders: ListItem[]; channels: ListItem[] }
export const NONE: Suggested = { records: [], files: [], folders: [], channels: [] };

type Hit = CapMap["search.query"]["out"]["hits"][number];

export function itemOf(h: Hit): { group: keyof Suggested; item: ListItem } | null {
  if (h.kind === "record") return { group: "records", item: { t: h.title, ...(h.recordType ? { s: h.recordType } : {}), kind: "Record", ref: h.id } };
  if (h.kind === "file") return { group: "files", item: { t: h.title, ...(h.path ? { s: h.path } : {}), kind: "File", ref: h.id } };
  if (h.kind === "channel") return { group: "channels", item: { t: h.title, kind: "Channel", ref: h.id } };
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
  const types = ch === "[[" ? ["record"] : ["record", "file", "channel"];
  const out: Suggested = { records: [], files: [], folders: [], channels: [] };
  const hits = q === ""
    ? ((await data.call("search.recent.list", { types, limit: 12 })) as CapMap["search.recent.list"]["out"]).hits
    : ((await data.call("search.query", { q, types, limit: 12 })) as CapMap["search.query"]["out"]).hits;
  for (const h of hits) { const m = itemOf(h); if (m) out[m.group].push(m.item); }
  if (ch === "#") {
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
