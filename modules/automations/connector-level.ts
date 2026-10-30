// The level of one connector action or trigger. A caller cannot mark an action tested or published.
// The row stores the key and the level. It does not store a secret or a field value.
export type StoredLevel = "draft" | "tested" | "published";

export interface LevelDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

export function recordConnectorLevel(db: LevelDb, actionKey: string, level: StoredLevel, now: number): void {
  db.run(
    `INSERT OR REPLACE INTO automations_connector_levels (action_key, level, updated_at) VALUES (?, ?, ?)`,
    actionKey, level, now,
  );
}

export function storedLevel(db: LevelDb, actionKey: string): StoredLevel | undefined {
  const rows = db.all(
    `SELECT level FROM automations_connector_levels WHERE action_key = ?`,
    actionKey,
  ) as { level?: unknown }[];
  const level = rows[0]?.level;
  return level === "draft" || level === "tested" || level === "published" ? level : undefined;
}

export function clearConnectorLevel(db: LevelDb, actionKey: string): void {
  db.run(`DELETE FROM automations_connector_levels WHERE action_key = ?`, actionKey);
}

/** A tested or published level has been proven by a read. */
export function proven(level: StoredLevel | undefined): boolean {
  return level === "tested" || level === "published";
}
