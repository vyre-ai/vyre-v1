// A request to start Send for signature from outside Files (the command palette): the host in the shell takes it, asks which PDF, then opens the one sheet. Same shape as the channel sheet's request.
let pending = false;
const listeners = new Set<() => void>();

export function requestSignPicker(): void {
  pending = true;
  for (const l of [...listeners]) l();
}

/** The waiting request, once. */
export function takeSignRequest(): boolean {
  const p = pending;
  pending = false;
  return p;
}

export function onSignRequest(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** The PDFs of a recent-files answer, newest first, narrowed by what the person typed. */
export function pdfsOf(
  files: readonly { fileId: string; name: string; mime: string; folderId?: string }[],
  q: string,
): { fileId: string; name: string }[] {
  const w = q.trim().toLowerCase();
  return files
    .filter((f) => /\.pdf$/i.test(f.name) || f.mime === "application/pdf")
    .filter((f) => w === "" || f.name.toLowerCase().includes(w))
    .map((f) => ({ fileId: f.fileId, name: f.name }));
}
