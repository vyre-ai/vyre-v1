// File references in a note, resolved (rc.8): a name or path written in a file's words is looked up where a person would look: this file's folder, the folders above it up to the top of Files, then by path, then
// (for [[links]] and markdown links) a search for the exact name. A file found is a link; a [[link]] or markdown link to nothing is a broken link that can create the file beside this one.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CapMap } from "../../../../../generated/types.ts";
import { distinctRefs } from "../../../../../ui/src/Viewer/index.tsx";
import type { FileLinkTarget, FileLinks, FileRef } from "../../../../../ui/src/Viewer/index.tsx";

type Call = (cap: string, input: unknown) => Promise<unknown>;
type Folder = CapMap["files.folder.get"]["out"]["folder"];
type Listed = CapMap["files.list"]["out"]["files"][number];

export const MAX_UP = 6;
export const MAX_REFS = 40;

const ci = (a: string, b: string): boolean => a.localeCompare(b, "en", { sensitivity: "accent" }) === 0;

/** The folder of the file and the folders above it, nearest first. */
export async function folderChain(call: Call, folderId: string): Promise<Folder[]> {
  const out: Folder[] = [];
  let at: string | undefined = folderId;
  for (let i = 0; i < MAX_UP && at !== undefined; i++) {
    const f: Folder | undefined = await (call("files.folder.get", { folderId: at }) as Promise<CapMap["files.folder.get"]["out"]>).then((o) => o.folder, () => undefined);
    if (!f) break;
    out.push(f);
    at = f.parentId;
  }
  return out;
}

/** A relative path written in a note ("../VYRE.md", "docs/plan.md") as a tree path from the folder the file is in. */
export function treePath(folderPath: string, ref: string): string {
  const base = folderPath.split("/").filter((s) => s !== "");
  for (const seg of ref.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") base.pop(); else base.push(seg);
  }
  return base.join("/");
}

const targetOf = (f: Listed, folders: readonly Folder[]): FileLinkTarget => {
  const dir = folders.find((x) => x.folderId === f.folderId);
  return { id: f.fileId, name: f.name, ...(dir ? { path: dir.path === "" ? f.name : `${dir.path}/${f.name}` } : {}) };
};

/** What each reference points at: the file, or null (a [[link]] or markdown link to nothing). A bare name that is not a file here comes back null too and stays plain words. */
export async function resolveTargets(call: Call, at: { folderId: string }, refs: readonly FileRef[]): Promise<Map<string, FileLinkTarget | null>> {
  const out = new Map<string, FileLinkTarget | null>();
  const wanted = refs.slice(0, MAX_REFS);
  if (wanted.length === 0) return out;
  const chain = await folderChain(call, at.folderId);
  const lists = new Map<string, Listed[]>();
  const filesIn = async (folderId: string): Promise<Listed[]> => {
    const hit = lists.get(folderId);
    if (hit) return hit;
    const l = await (call("files.list", { folder: folderId, limit: 500 }) as Promise<CapMap["files.list"]["out"]>).then((o) => o.files, () => [] as Listed[]);
    lists.set(folderId, l);
    return l;
  };
  const near = async (name: string): Promise<FileLinkTarget | undefined> => {
    for (const f of chain) {
      const hit = (await filesIn(f.folderId)).find((x) => ci(x.name, name));
      if (hit) return targetOf(hit, chain);
    }
    return undefined;
  };
  for (const r of wanted) {
    let found: FileLinkTarget | undefined;
    const name = r.ref.split("/").pop() ?? r.ref;
    if (r.ref.includes("/")) {
      const here = chain[0]?.path ?? "";
      for (const path of [treePath(here, r.ref), r.ref]) {
        const got = await (call("files.resolve", { path }) as Promise<CapMap["files.resolve"]["out"]>).then((o) => o, () => undefined);
        if (got?.kind === "file" && got.fileId) { found = { id: got.fileId, name, path }; break; }
      }
    }
    found ??= await near(name);
    // a [[Name]] is often written without its extension
    if (!found && r.kind === "wiki" && !/\.\w{1,5}$/.test(name)) found = await near(`${name}.md`);
    if (!found && r.kind !== "bare") {
      const hits = await (call("search.query", { q: name, types: ["file"], limit: 8 }) as Promise<CapMap["search.query"]["out"]>).then((o) => o.hits, () => []);
      const exact = hits.find((h) => ci(h.title, name) || ci(h.title, `${name}.md`));
      if (exact) found = { id: exact.id, name: exact.title, ...(exact.path ? { path: exact.path } : {}) };
    }
    out.set(r.ref, found ?? null);
  }
  return out;
}

/** The name a missing [[link]] would be created with. */
export const newFileName = (ref: string): string => { const n = ref.split("/").pop() ?? ref; return /\.\w{1,5}$/.test(n) ? n : `${n}.md`; };

export interface LinkDeps {
  call: Call;
  /** Open a file in a tab; `background` leaves the person where they are. */
  openFileTab?(fileId: string, background: boolean): void;
}

/** Open a file named in words, such as the Inherits VYRE.md chip: looked up near the file, opened in a tab. False when there is no such file. */
export async function openByName(d: LinkDeps, folderId: string, name: string, background = false): Promise<boolean> {
  const got = (await resolveTargets(d.call, { folderId }, [{ start: 0, end: 0, label: name, ref: name, kind: "bare" }])).get(name);
  if (!got) return false;
  d.openFileTab?.(got.id, background);
  return true;
}

/** The links of one file's words: refs looked up once the text is known, kept while it does not change, drawn as the viewer's `fileLinks`. */
export function useFileLinks(d: LinkDeps, file: { folderId: string } | null, text: string): FileLinks | undefined {
  const refs = useMemo(() => distinctRefs(text), [text]);
  const [targets, setTargets] = useState<ReadonlyMap<string, FileLinkTarget | null>>(new Map());
  const folderId = file?.folderId;
  useEffect(() => {
    if (folderId === undefined || refs.length === 0) { setTargets(new Map()); return undefined; }
    let live = true;
    void resolveTargets(d.call, { folderId }, refs).then((m) => { if (live) setTargets(m); }, () => undefined);
    return () => { live = false; };
  }, [d.call, folderId, refs]);
  const open = useCallback((t: FileLinkTarget, background: boolean): void => d.openFileTab?.(t.id, background), [d]);
  const create = useCallback((ref: string): void => {
    if (folderId === undefined) return;
    void (d.call("files.create", { folderId, name: newFileName(ref), content: { text: "" }, idempotencyKey: `filelink:${folderId}:${ref}` }) as Promise<{ file: { fileId: string; name: string } }>).then((o) => {
      setTargets((cur) => new Map(cur).set(ref, { id: o.file.fileId, name: o.file.name }));
      d.openFileTab?.(o.file.fileId, false);
    }, () => undefined);
  }, [d, folderId]);
  return useMemo(() => (refs.length === 0 || !d.openFileTab ? undefined : { targets, open, create }), [refs.length, d.openFileTab, targets, open, create]);
}
