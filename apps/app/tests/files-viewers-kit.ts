// Shared by apps/app/tests/files.viewers.pdf*.live.test.ts (not a test file).
export type Pg = import("playwright-core").Page;
export const drawn = (page: Pg, n: number): Promise<boolean> =>
  page.evaluate((k) => !!document.querySelector(`[data-testid="vwp-page-${k}"] canvas`), n);
