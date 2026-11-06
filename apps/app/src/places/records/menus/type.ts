// The menu of a record type in the Records sidebar: Open, Star, Copy Name and, for a person who may change structure, Edit Type. Each item is one call or one navigation the place already
// makes (the type opens, stars.toggle on the record_type, the Record types list where fields are edited). Pure: facts in, entries out.
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { item, tidy } from "../../../../../../ui/src/Menu/entries.ts";

export interface TypeFacts { starred: boolean; canEdit: boolean }
export interface TypeDo { open(): void; star?(on: boolean): void; copyName?(): void; editType?(): void }

export function typeMenu(f: TypeFacts, d: TypeDo): MenuEntry[] {
  return tidy([
    item("Open", d.open, { hint: "Enter" }),
    d.star ? item(f.starred ? "Remove star" : "Star", () => d.star?.(!f.starred)) : null,
    d.copyName ? item("Copy Name", d.copyName) : null,
    f.canEdit && d.editType ? item("Edit Type…", d.editType) : null,
  ]);
}
