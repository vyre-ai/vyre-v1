// The imported sessions changed on this device (a rename, an archive, a delete): the sidebar's Imported list and an open transcript read them again. sessions.list is a plain call, not a live
// query, so this is how a rename on the transcript page reaches the sidebar row and the other way round.
const listeners = new Set<() => void>();

export function importedChanged(): void {
  for (const l of [...listeners]) l();
}

export function onImportedChange(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
