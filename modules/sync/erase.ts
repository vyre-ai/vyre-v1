// Erase and the sync tables (P-CC_41). sync_changes keeps the field values of every change and sync_rows the current values of every row, so an erased record's text would live on there after the event
// log forgot it. This blanks the values and keeps the rows, so a device's cursor still lands on a change and a device that holds the row still gets its delete.
//   sync_changes  every change of an erased entity id, and every change made by an event the log erased (by seq), gets fields = {}.
//   sync_rows     the current row of an erased entity id gets fields = {}. Other rows that an erased event only touched keep their own values: they are live rows, not erased ones.
// The host calls this from the events port it binds for governance (host/src/daemon/daemon.ts), right after the log is compacted and again after a restore replays the seqs.
export interface BlankDb { run(sql: string, ...args: unknown[]): unknown }

const CHUNK = 400;
const marks = (n: number): string => Array.from({ length: n }, () => "?").join(",");

export function blankErased(db: BlankDb, scope: { ids?: readonly string[]; seqs?: readonly number[] }): void {
  const ids = [...new Set(scope.ids ?? [])];
  const seqs = [...new Set(scope.seqs ?? [])];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    db.run(`UPDATE sync_changes SET fields = '{}' WHERE id IN (${marks(part.length)})`, ...part);
    db.run(`UPDATE sync_rows SET fields = '{}' WHERE id IN (${marks(part.length)})`, ...part);
  }
  for (let i = 0; i < seqs.length; i += CHUNK) {
    const part = seqs.slice(i, i + CHUNK);
    db.run(`UPDATE sync_changes SET fields = '{}' WHERE seq IN (${marks(part.length)})`, ...part);
  }
}
