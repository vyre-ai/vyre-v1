/** True when a popover drawn above the composer would start higher than the top of the pane that holds it, so its first rows could not be seen or pressed: it opens below the composer instead. */
export function popOpensBelow(o: { popTop: number; paneTop: number }): boolean {
  return o.popTop < o.paneTop;
}

/** The top edge of the nearest ancestor that clips what is drawn outside it (overflow hidden, auto, scroll or clip), or 0 for the window. */
export function clipTop(node: unknown): number {
  const g = globalThis as { getComputedStyle?: (e: unknown) => { overflowY: string; overflow: string } };
  let el = (node as { parentElement?: unknown } | null)?.parentElement as
    | { parentElement?: unknown; getBoundingClientRect(): { top: number } }
    | null
    | undefined;
  while (el) {
    const cs = g.getComputedStyle?.(el);
    if (cs && /hidden|auto|scroll|clip/.test(`${cs.overflowY} ${cs.overflow}`)) return el.getBoundingClientRect().top;
    el = el.parentElement as typeof el;
  }
  return 0;
}
