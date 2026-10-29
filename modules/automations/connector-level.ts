// The level of one connector action. A caller cannot mark an action tested.
// The row stores the action key and the level. It does not store a secret or a field value.

export interface LevelDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

export function recordConnectorLevel(db: LevelDb, actionKey: string, level: "draft" | "tested", now: number): void {
  db.run(
    `INSERT OR REPLACE INTO automations_connector_levels (action_key, level, updated_at) VALUES (?, ?, ?)`,
    actionKey, level, now,
  );
}

export function storedLevel(db: LevelDb, actionKey: string): "draft" | "tested" | undefined {
  const rows = db.all(
    `SELECT level FROM automations_connector_levels WHERE action_key = ?`,
    actionKey,
  ) as { level?: unknown }[];
  const level = rows[0]?.level;
  return level === "draft" || level === "tested" ? level : undefined;
}
