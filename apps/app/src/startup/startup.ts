// Startup path (ARCH 7, speed b12): open app to usable in under 1 s on desktop, 1.5 s on phone.
//   1. app.start
//   2. read persisted UI state synchronously (last place, rail), no await
//   3. open the replica and create its prepared statements
//   4. read the first list from SQL and render it, then app.usable
//   5. only after that, open the connection in the background
// Nothing before step 5 touches the network. The ports are injected so the order is testable.

import { resolveLastPlace } from "./places.ts";
import type { PlaceId } from "./places.ts";

export interface UiState {
  lastPlace: string | null;
  railOrder: string[];
}

export interface UiStateStore {
  /** Synchronous: localStorage on web, MMKV-style store on native. */
  read(): UiState;
  write(patch: Partial<UiState>): void;
}

export interface PreparedStatement<Row> {
  all(params?: readonly unknown[]): Row[];
}

export interface ReplicaPort {
  prepare<Row>(sql: string): PreparedStatement<Row>;
}

export interface StartupDeps<Row> {
  ui: UiStateStore;
  replica: ReplicaPort;
  /** Draws the shell: rail, last place and its first list. Called once with rows already read. */
  render(view: { place: PlaceId; rail: string[]; rows: Row[] }): void;
  /** Starts the connection. Never awaited, never on the critical path. */
  connect(): void;
  mark(name: "app.start" | "app.usable"): void;
  schedule?(fn: () => void): void;
}

/** SQL for the first list of each place; statements are prepared up front so the first query pays no parse cost. */
export const FIRST_LIST_SQL: Record<string, string> = {
  home: "select id, title from home_items order by updated_at desc limit 50",
  files: "select id, name as title from files order by updated_at desc limit 50",
  records: "select id, title from records order by updated_at desc limit 50",
};
const FALLBACK_SQL = "select id, title from items order by updated_at desc limit 50";

export function startup<Row>(deps: StartupDeps<Row>): { place: PlaceId; rows: Row[] } {
  deps.mark("app.start");
  const state = deps.ui.read();
  const place = resolveLastPlace(state.lastPlace);
  const prepared = new Map<string, PreparedStatement<Row>>();
  for (const sql of new Set([...Object.values(FIRST_LIST_SQL), FALLBACK_SQL])) prepared.set(sql, deps.replica.prepare<Row>(sql));
  const stmt = prepared.get(FIRST_LIST_SQL[place] ?? FALLBACK_SQL)!;
  const rows = stmt.all();
  deps.render({ place, rail: state.railOrder, rows });
  deps.mark("app.usable");
  (deps.schedule ?? ((fn) => void setTimeout(fn, 0)))(deps.connect);
  return { place, rows };
}
