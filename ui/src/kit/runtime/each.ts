// Builds an array from items with a plain loop. Kit screens render element lists through this, and every list of rows goes
// through ui/VirtualList with a ui/Row, so no `.map(` of JSX appears in the runtime (lint ui-rows).
export function each<T, R>(items: readonly T[], build: (item: T, index: number) => R): R[] {
  const out: R[] = [];
  for (let i = 0; i < items.length; i++) out.push(build(items[i] as T, i));
  return out;
}
