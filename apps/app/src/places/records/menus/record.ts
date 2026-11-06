// The menu of a record in a table: what fits one record or a pick of them, as plain entries. Each item is one capability call the table already makes (records.delete, records.export,
// stars.toggle, access.share through the Share sheet); a hint names only a key the table answers to (Enter opens, S stars). Pure: facts in, entries out.
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { item, sep, tidy } from "../../../../../../ui/src/Menu/entries.ts";

export interface RecordFacts {
  /** How many records the menu is about (the pick, or the whole table when `every`). */
  n: number;
  /** The whole table is picked: nothing is opened or starred one at a time. */
  every: boolean;
  /** The menu was opened on one record (not a pick of several). */
  single: boolean;
  /** Is it starred? Unknown (no stars read yet) shows Star. */
  starred: boolean;
  /** May this person export (no access sheet means yes)? */
  canExport: boolean;
  /** Nothing is picked, so the menu is the table's: Export is allowed on the view's rows. */
  nothingPicked?: boolean;
}

export interface RecordDo {
  open(): void;
  star?(on: boolean): void;
  share?(): void;
  copyLink?(): void;
  exportCsv(): void;
  remove(): void;
}

export function recordMenu(f: RecordFacts, d: RecordDo): MenuEntry[] {
  const one = f.single && !f.every;
  return tidy([
    one ? item("Open", d.open, { hint: "Enter" }) : null,
    one && d.star ? item(f.starred ? "Remove Star" : "Star", () => d.star?.(!f.starred), { hint: "S" }) : null,
    one && d.share ? item("Share…", d.share) : null,
    one && d.copyLink ? item("Copy Link", d.copyLink) : null,
    one ? sep : null,
    (f.every || f.nothingPicked) && f.canExport ? item("Export as CSV", d.exportCsv) : null,
    sep,
    item(f.n === 1 ? "Delete" : `Delete ${f.n.toLocaleString("en-US")} records`, d.remove, { danger: true }),
  ]);
}
