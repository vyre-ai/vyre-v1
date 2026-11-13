// A document whose Escape reaches the layers (ui/Overlay/escape.ts) the way a browser's capture phase does: for tests of "Esc puts it away". Call restore() in the test's finally.
type Fn = (e: { key?: string; defaultPrevented?: boolean; preventDefault?: () => void; stopPropagation?: () => void }) => void;

export function fakeEscape(): { esc(): void; restore(): void } {
  const g = globalThis as { document?: Record<string, unknown> };
  const had = g.document;
  const cap = new Set<Fn>(), bub = new Set<Fn>();
  g.document = { ...(had ?? {}), addEventListener: (_t: string, f: Fn, c?: boolean) => { (c ? cap : bub).add(f); }, removeEventListener: (_t: string, f: Fn, c?: boolean) => { (c ? cap : bub).delete(f); } };
  return {
    esc: () => { const e = { key: "Escape", preventDefault() { /* nothing */ }, stopPropagation() { /* nothing */ } }; for (const f of [...cap, ...bub]) f(e); },
    restore: () => { if (had === undefined) delete g.document; else g.document = had; },
  };
}
