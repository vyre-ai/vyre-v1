// What the Files place's New folder, Rename and Upload do (the doors in FilesNav). They were `rt.open` calls with arguments nothing read, so the empty state's New folder, the New menu, the sidebar + and Rename did
// nothing a person could see, and Upload had no door at all. The place asks for a name (a sheet) and these make the change; every one is a capability call as the signed-in person.
import { storeFiles } from "../../places/chats/conversation/actions.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;
type Put = ((url: string, bytes: Uint8Array) => Promise<void>) | undefined;

let seq = 0;
const key = (what: string): string => `files-${what}:${Date.now()}:${++seq}`;

/** The top folder of a scope: Space, or the person's own Personal root. Null when the Space has none yet. */
export async function rootOf(call: Call, scope: "personal" | "space"): Promise<string | null> {
  const out = (await call("files.tree", {})) as { roots?: Array<{ key: string; kind: string; folderId?: string }> };
  const roots = (out.roots ?? []).filter((r) => r.kind === "folder" && r.folderId !== undefined);
  return (roots.find((r) => r.key === scope) ?? roots.find((r) => r.key === "personal") ?? roots[0])?.folderId ?? null;
}

/** Make a folder inside `parentId` (null: the top of the scope) and return its id. */
export async function newFolderIn(call: Call, scope: "personal" | "space", parentId: string | null, name: string): Promise<string> {
  const clean = name.trim();
  if (clean === "") throw new Error("Give the folder a name.");
  const parent = parentId ?? (await rootOf(call, scope));
  if (!parent) throw new Error("There is no place to put it yet.");
  const out = (await call("files.folder.create", { parentId: parent, name: clean, idempotencyKey: key("folder") })) as { folder: { folderId: string } };
  return out.folder.folderId;
}

export async function renameEntry(call: Call, kind: "file" | "folder", id: string, name: string): Promise<void> {
  const clean = name.trim();
  if (clean === "") throw new Error("Give it a name.");
  await call(kind === "file" ? "files.rename" : "files.folder.rename", kind === "file" ? { fileId: id, name: clean, idempotencyKey: key("rename") } : { folderId: id, name: clean, idempotencyKey: key("rename") });
}

interface Chosen { name: string; mime: string; file: unknown }
type Doc = { createElement(t: string): unknown; body?: { appendChild(n: unknown): void; removeChild(n: unknown): void } };

/** The page's file chooser for any number of files; an empty list when it is cancelled or the page has none. */
export function pickFiles(): Promise<Chosen[]> {
  const doc = (globalThis as { document?: Doc }).document;
  if (!doc) return Promise.resolve([]);
  return new Promise((resolve) => {
    const input = doc.createElement("input") as { type: string; multiple: boolean; style?: { display: string }; files?: ArrayLike<{ name: string; type: string }>; onchange: (() => void) | null; oncancel: (() => void) | null; click(): void; setAttribute?(k: string, v: string): void };
    input.type = "file";
    input.multiple = true;
    input.setAttribute?.("data-testid", "files-upload-input");
    if (input.style) input.style.display = "none";
    // WKWebView (the desktop app on a Mac) only opens a chooser for an input that is in the page: attach it, hidden, for the click, and take it out when it answers.
    doc.body?.appendChild(input);
    const done = (): void => { try { doc.body?.removeChild(input); } catch { /* already gone */ } };
    input.oncancel = () => { done(); resolve([]); };
    input.onchange = () => { done(); resolve(Array.from(input.files ?? []).map((f) => ({ name: f.name, mime: f.type, file: f }))); };
    input.click();
  });
}

/** Choose files and store them in a folder (null: the top of the Personal scope). Returns how many were stored. */
export async function uploadInto(call: Call, putBlob: Put, folderId: string | null): Promise<number> {
  const files = await pickFiles();
  if (files.length === 0) return 0;
  const into = folderId ?? (await rootOf(call, "personal"));
  if (!into) throw new Error("There is no place to put them yet.");
  return (await storeFiles({ call: call as never, ...(putBlob ? { putBlob } : {}) }, into, files, key("upload"))).length;
}
