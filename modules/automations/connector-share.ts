// A tested connector offered to another Space. The copy has the app name and the actions.
// The copy stays draft. The other Space tests it with their own key before it can be published.
// A vault id and a key value are not stored.

import { shareWithoutKeys } from "./connector-breadth.ts";
import type { NamedAction } from "./connector-breadth.ts";
import type { LevelDb } from "./connector-level.ts";

export interface SharedConnector {
  appName: string;
  actions: NamedAction[];
}

const LIVE_KEY = "sk_live_";

function collapsed(value: string): string {
  return value.replace(/\s+/g, "");
}

function safeName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || collapsed(trimmed).includes(LIVE_KEY)) return "this app";
  return trimmed;
}

function safeTitle(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0 || collapsed(trimmed).includes(LIVE_KEY)) return undefined;
  return trimmed;
}

export function saveSharedConnector(db: LevelDb, shared: SharedConnector, now: number): void {
  for (const action of shared.actions) {
    db.run(
      `INSERT OR REPLACE INTO automations_shared_connectors (action_key, app_name, title, level, updated_at) VALUES (?, ?, ?, ?, ?)`,
      action.key, shared.appName, action.title, action.level, now,
    );
  }
}

export function listSharedConnectors(db: LevelDb): SharedConnector[] {
  const rows = db.all(
    `SELECT app_name, action_key, title, level FROM automations_shared_connectors ORDER BY app_name, action_key`,
  ) as { app_name?: unknown; action_key?: unknown; title?: unknown; level?: unknown }[];
  const byApp = new Map<string, NamedAction[]>();
  for (const row of rows) {
    if (typeof row.app_name !== "string" || typeof row.action_key !== "string" || typeof row.title !== "string") continue;
    if (row.level !== "tested" && row.level !== "draft") continue;
    const actions = byApp.get(row.app_name) ?? [];
    actions.push({ key: row.action_key, title: row.title, level: row.level });
    byApp.set(row.app_name, actions);
  }
  return [...byApp.entries()].map(([appName, actions]) => shareWithoutKeys({ appName, actions }));
}

export function shareTested(db: LevelDb, appName: string, actions: readonly { key: string; title: string }[], tested: (key: string) => boolean, now: number): SharedConnector {
  const kept: NamedAction[] = [];
  for (const action of actions) {
    if (!tested(action.key)) continue;
    if (collapsed(action.key).includes(LIVE_KEY)) continue;
    const title = safeTitle(action.title);
    if (title === undefined) continue;
    kept.push({ key: action.key, title, level: "draft" });
  }
  const shared = shareWithoutKeys({ appName: safeName(appName), actions: kept });
  saveSharedConnector(db, shared, now);
  return shared;
}
