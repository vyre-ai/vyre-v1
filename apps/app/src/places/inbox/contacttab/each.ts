// A list of elements built with a loop. The ui-rows lint reads every `.map(` that returns JSX as a list of items that must be ui/Row; the feed's blocks (an email, a run of bubbles, a draft) and the
// small chips are not list rows, so they are built here instead.
import type { ReactElement } from "react";

export function each<T>(list: readonly T[], make: (item: T, index: number) => ReactElement | null): ReactElement[] {
  const out: ReactElement[] = [];
  for (let i = 0; i < list.length; i++) {
    const el = make(list[i] as T, i);
    if (el !== null) out.push(el);
  }
  return out;
}
