// File and folder pick (spec 3.13 native pages): the page asks for a kind of pick, the shell opens the system dialog, and what comes back is checked
// before the page sees it. Pure functions here; src-tauri/src/native.rs opens the dialog.

export const MAX_PICKED = 500;
export const MAX_FILTERS = 8;
export const MAX_EXTENSIONS = 32;

export type PickKind = "files" | "file" | "folder";
export type PickRequest = { kind: PickKind; title?: string; accept?: Record<string, readonly string[]>; startIn?: string };
export type PickOptions = { kind: PickKind; title: string; multiple: boolean; directory: boolean; filters: { name: string; extensions: string[] }[]; startIn?: string };

/** An extension as the dialog wants it: letters and digits only, lower case, no dot ("*.PDF" -> "pdf"). Anything else is dropped. */
export function cleanExtension(e: string): string | null {
  const x = e.trim().replace(/^\*?\./, "").toLowerCase();
  return /^[a-z0-9]{1,16}$/.test(x) ? x : null;
}

export function pickOptions(req: PickRequest): PickOptions {
  const directory = req.kind === "folder";
  const filters: PickOptions["filters"] = [];
  if (!directory) {
    for (const [name, exts] of Object.entries(req.accept ?? {}).slice(0, MAX_FILTERS)) {
      const extensions = [...new Set(exts.map(cleanExtension).filter((x): x is string => x !== null))].slice(0, MAX_EXTENSIONS);
      const label = name.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 40);
      if (label && extensions.length) filters.push({ name: label, extensions });
    }
  }
  const o: PickOptions = { kind: req.kind, title: (req.title ?? (directory ? "Choose a folder" : req.kind === "file" ? "Choose a file" : "Choose files")).slice(0, 80), multiple: req.kind === "files", directory, filters };
  if (req.startIn && isAbsolutePath(req.startIn)) o.startIn = req.startIn;
  return o;
}

export function isAbsolutePath(p: string): boolean {
  if (typeof p !== "string" || p.length === 0 || p.length > 4096 || /[\u0000-\u001f]/.test(p)) return false;
  if (p.split(/[\\/]/).includes("..")) return false;
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\");
}

/** What the page receives: absolute paths only, no `..`, no duplicates, at most MAX_PICKED, and one path when one was asked for. */
export function checkPicked(opts: Pick<PickOptions, "multiple">, paths: readonly string[] | null | undefined): string[] {
  if (!paths) return [];
  const ok = [...new Set(paths.filter(isAbsolutePath))];
  return opts.multiple ? ok.slice(0, MAX_PICKED) : ok.slice(0, 1);
}
