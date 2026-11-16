// Shared by apps/app/tests/files.viewers.pdf*.live.test.ts (not a test file).
// The page is typed by the one call used here, so this file needs no browser package.
export type Pg = { evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R> };
export const drawn = (page: Pg, n: number): Promise<boolean> =>
  page.evaluate((k: number) => !!document.querySelector(`[data-testid="vwp-page-${k}"] canvas`), n);
