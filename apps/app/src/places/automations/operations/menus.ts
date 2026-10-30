// Menu entries the Studio views share. A filter is a quiet header menu: a check beside each chosen value and its count in the right column.
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";

export interface FilterOption { value: string; label?: string; count: number }

/** "All" is checked while nothing is picked. Choosing a value toggles it. "All" clears the picks. */
export function filterMenu(allLabel: string, options: readonly FilterOption[], chosen: ReadonlySet<string>, onToggle: (value: string) => void, onClear: () => void): MenuEntry[] {
  const total = options.reduce((n, o) => n + o.count, 0);
  return [
    { label: allLabel, checked: chosen.size === 0, count: total, onSelect: onClear },
    ...options.map((o): MenuEntry => ({ label: o.label ?? o.value, checked: chosen.has(o.value), count: o.count, onSelect: () => onToggle(o.value) })),
  ];
}

/** One value out of a few, such as the time range. */
export function choiceMenu<T extends string | number>(options: readonly { value: T; label: string }[], current: T, onChoose: (value: T) => void): MenuEntry[] {
  return options.map((o): MenuEntry => ({ label: o.label, checked: o.value === current, onSelect: () => onChoose(o.value) }));
}

/** How a filter button reads: the word alone when nothing is picked, else the word and what is picked. */
export function filterLabel(word: string, chosen: ReadonlySet<string>, labelOf: (value: string) => string = (v) => v): string {
  if (chosen.size === 0) return word;
  const names = [...chosen].map(labelOf);
  return names.length === 1 ? `${word}: ${names[0]}` : `${word}: ${names.length} chosen`;
}
