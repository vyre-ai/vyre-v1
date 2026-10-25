// A plain loop that builds the children of a group from data. Lists of things a person selects are the shared ui/Row (the ui-rows lint holds the line); this is for what is not a list of
// rows: the lines of a run's log, the bullets in a turn, the blocks of a loading skeleton, the entries of a menu.
export function each<T, R>(items: readonly T[], make: (item: T, index: number) => R): R[] {
  const out: R[] = [];
  for (let i = 0; i < items.length; i++) out.push(make(items[i] as T, i));
  return out;
}
