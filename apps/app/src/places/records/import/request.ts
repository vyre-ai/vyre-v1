// A request to open the import sheet from outside the Records table (the command palette, the sidebar's menu of a type). The table takes it when it is drawn, or at once if it is already there.
let pending: string | null | undefined;
const listeners = new Set<() => void>();

/** Ask for the import sheet on a record type; null means the type the table shows. */
export function requestImport(type: string | null = null): void {
  pending = type;
  for (const l of [...listeners]) l();
}

/** True once when a request waits for this type (or for whichever table is on screen); a request for another type stays for its own table. */
export function takeImportRequest(type: string): boolean {
  if (pending === undefined || (pending !== null && pending !== type)) return false;
  pending = undefined;
  return true;
}

export function onImportRequest(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
