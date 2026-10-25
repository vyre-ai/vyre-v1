import type { ReactElement } from "react";
export function each<T>(list: readonly T[], make: (item: T, index: number) => ReactElement | null): ReactElement[] {
  const out: ReactElement[] = [];
  for (let i = 0; i < list.length; i++) { const el = make(list[i] as T, i); if (el !== null) out.push(el); }
  return out;
}
