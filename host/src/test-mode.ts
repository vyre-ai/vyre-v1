// Test switches in product code (the key check's accept mode) work only inside the test runner. scripts/test-run.ts starts every test file with `--import scripts/lib/test-marker.mjs`, which sets a global
// that nothing in a server's own start sets; an environment variable alone (VYRE_TEST_KEY_CHECK=accept copied into a server's .env) is ignored, and the daemon says so once when it starts.
const MARK = Symbol.for("vyre.test-runner");

/** True only in a process started by scripts/test-run.ts (or a child of one). A production daemon never has it. */
export const inTestRunner = (): boolean => (globalThis as Record<symbol, unknown>)[MARK] === true;

/** A test switch that is set outside the test runner is removed and reported once. Returns the names it removed. */
export function ignoreTestSwitches(say: (line: string) => void = (l) => process.stderr.write(l)): string[] {
  if (inTestRunner()) return [];
  const gone = ["VYRE_TEST_KEY_CHECK"].filter((k) => process.env[k] !== undefined);
  for (const k of gone) delete process.env[k];
  if (gone.length) say(`vyred: ${gone.join(", ")} is a test setting and is ignored outside the test runner\n`);
  return gone;
}

/** The runtime's own fetch, kept when this file loads (before a test can replace globalThis.fetch with a stand-in vendor). A test that hands in a fetch, or puts a stand-in in globalThis.fetch, reaches no real provider. */
const nativeFetch = globalThis.fetch;
export const isNativeFetch = (f: unknown): boolean => f === nativeFetch;
