// A loop of many short synchronous steps (a write into SQLite, a vector, a page of rows) holds the server's single event loop for as long as the whole loop takes: a pass that writes 2,000 records
// held it for about 2 s (17 Nov 2026, a firm's first sync), so every request and the live stream waited. `await turn()` in such a loop gives the loop back, at most once per `budgetMs` of work, so
// a person's request is answered between two steps and the loop is never held longer than about the budget plus one step.

/** The default share of work between two turns, in milliseconds. */
export const TURN_BUDGET_MS = 15;

/** One turn counter per loop: call the returned function at the end of every step. */
export function turns(budgetMs: number = TURN_BUDGET_MS): () => Promise<void> {
  let since = performance.now();
  return async () => {
    if (performance.now() - since < budgetMs) return;
    await new Promise<void>((done) => setImmediate(done));
    since = performance.now();
  };
}
