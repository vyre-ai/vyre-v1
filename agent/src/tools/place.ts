// Where a model's first file or folder goes (16 Nov 2026, finding F93: an Assistant asked to "put this table in a file in my files" was refused three times before a save went through). A model writes
// `files_create {name, text}` and does not know a folder id; it writes `path: "Reports/plan.md"`, `folder: "Personal"` or a folder called by name. The tool layer takes the person's own files when no folder is
// named, reads a path or a folder name the way the model meant it (making the folders on the way when the call is not waiting for a yes), and finds a file by its path for a write or a read. The server
// still validates the full input and checks access: nothing here widens what an agent may do, it only fills what a model cannot know.

/** The input that names the folder a new thing goes in, by capability. A model that names none means the person's own files. */
const PLACES: Readonly<Record<string, string>> = {
  "files.create": "folderId",
  "files.folder.create": "parentId",
  "documents.fill": "intoFolderId",
  "sheets.create": "folderId",
};
/** Capabilities that act on one file and take its id as `fileId`: a model that writes the file's tree path instead is understood. */
const BY_PATH: ReadonlySet<string> = new Set(["files.read", "files.get", "files.write", "files.viewer_data"]);

/** Other names a model gives the folder. */
const FOLDER_WORDS = ["folder", "folderPath", "dir", "directory", "parent", "parentFolder", "into", "location"];
const FILE_WORDS = ["path", "file", "filename", "fileName", "name"];

const FOLDER_ID = /^fld_[a-z0-9]+$/;
const ROOT_WORDS = /^(?:personal|my files|my documents|files|home|~|\.)$/i;

export const placeField = (cap: string): string | undefined => PLACES[cap];
export const findsByPath = (cap: string): boolean => BY_PATH.has(cap);

export type Run = (cap: string, input: Record<string, unknown>) => Promise<unknown | null>;

export interface Placed {
  input: unknown;
  /** One plain sentence for the model when the call cannot go on as asked (a folder that does not exist where nothing may be made, a file that is not there). */
  said?: string;
}

const isRec = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
const parts = (p: string): string[] =>
  p
    .split(/[\\/]+/)
    .map((x) => x.trim())
    .filter((x) => x !== "");

/** A date written with slashes in a name ("applicants 15/11/2026.md") is a date, not a folder. */
export const dateSlashes = (name: string): string => name.replace(/(\d)[\\/](?=\d)/g, "$1-");

/**
 * The input with the folder or file the model meant. `run` asks the server as the agent would (a read, or, when `mayMake`, the folder it names that does not exist yet).
 * `mayMake` is false when the call is parked for a yes: nothing is made before the person has said yes.
 */
export async function placeInput(cap: string, input: unknown, run: Run, mayMake: boolean): Promise<Placed> {
  if (!isRec(input)) return { input };
  const o: Record<string, unknown> = { ...input };
  const field = PLACES[cap];
  if (field !== undefined) {
    const given = o[field];
    if (typeof given === "string" && FOLDER_ID.test(given)) return { input };
    // where the model said the folder is: the input itself when it is not an id, a folder word, or the folder part of a path
    let where: string | undefined = typeof given === "string" ? str(given) : undefined;
    for (const w of FOLDER_WORDS) {
      const v = str(o[w]);
      if (v !== undefined) where ??= v;
      if (w in o && typeof o[w] === "string") delete o[w];
    }
    let name = str(o["name"]);
    if (name !== undefined) name = dateSlashes(name);
    if (cap === "files.create" || cap === "sheets.create") {
      const p = str(o["path"]) ?? str(o["file"]) ?? str(o["filename"]) ?? str(o["fileName"]);
      for (const w of ["path", "file", "filename", "fileName"]) if (typeof o[w] === "string") delete o[w];
      if (p !== undefined) {
        const ps = parts(dateSlashes(p));
        const last = ps.pop();
        if (name === undefined && last !== undefined) name = last;
        if (ps.length > 0) where = where === undefined ? ps.join("/") : `${where}/${ps.join("/")}`;
      }
      if (name !== undefined && /[\\/]/.test(name)) {
        const ps = parts(name);
        name = ps.pop() ?? name;
        if (ps.length > 0) where = where === undefined ? ps.join("/") : `${where}/${ps.join("/")}`;
      }
    }
    if (name !== undefined) o["name"] = name;
    delete o[field];
    const segs = where === undefined ? [] : parts(where);
    while (segs.length > 0 && ROOT_WORDS.test(segs[0] as string)) segs.shift();
    const root = (await run("files.resolve", { path: "Personal" })) as { folderId?: string } | null;
    if (typeof root?.folderId !== "string")
      return { input: o, said: "The person's own files could not be found. Name the folder with its id (files_list shows folders)." };
    let at: string = root.folderId;
    let walked = "Personal";
    for (const seg of segs) {
      walked += `/${seg}`;
      const found = (await run("files.resolve", { path: walked })) as { kind?: string; folderId?: string } | null;
      if (found?.kind === "folder" && typeof found.folderId === "string") {
        at = found.folderId;
        continue;
      }
      if (!mayMake)
        return {
          input: o,
          said: `There is no folder ${walked.replace(/^Personal\//, "")} yet. Make it first with files_folder_create, then ask again with its id.`,
        };
      const made = (await run("files.folder.create", { parentId: at, name: seg })) as {
        folder?: { folderId?: string };
      } | null;
      const id = made?.folder?.folderId;
      if (typeof id !== "string")
        return {
          input: o,
          said: `The folder ${seg} could not be made. Ask for the id of an existing folder (files_list shows folders) and try once more.`,
        };
      at = id;
    }
    o[field] = at;
    return { input: o };
  }
  if (BY_PATH.has(cap) && o["fileId"] === undefined) {
    let p: string | undefined;
    for (const w of FILE_WORDS) {
      const v = str(o[w]);
      if (v !== undefined) p ??= v;
      if (typeof o[w] === "string") delete o[w];
    }
    if (p === undefined) return { input: o };
    const ps = parts(p);
    const top = /^(?:Personal|Projects|Agents|People|Channels)$/.test(ps[0] ?? "");
    while (ps.length > 0 && ROOT_WORDS.test(ps[0] as string)) ps.shift();
    // a path from the tree's own roots is tried as written; any other is a path inside the person's own files
    for (const path of top ? [parts(p).join("/")] : [`Personal/${ps.join("/")}`]) {
      const f = (await run("files.resolve", { path })) as { kind?: string; fileId?: string } | null;
      if (f?.kind === "file" && typeof f.fileId === "string") {
        o["fileId"] = f.fileId;
        return { input: o };
      }
    }
    return {
      input: o,
      said:
        cap === "files.write"
          ? "There is no file at that path, so there is nothing to replace. To make a new file call files_create with a name and the text; leave the folder out to put it in the person's own files."
          : "There is no file at that path. files_list shows what is in a folder, and files_resolve turns a path into an id.",
    };
  }
  return { input: o };
}
