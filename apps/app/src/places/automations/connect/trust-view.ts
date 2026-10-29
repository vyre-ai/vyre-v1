// What the builder may show from connectors.list. Drafts stay with the author.
// Secret names and secret values are left out. The ladder matches modules/automations/trust.ts.

export type TrustLevel = "draft" | "private_verified" | "space_published" | "built_in";

export const CONNECT_LIMIT =
  "Vyre can draft a connector from official API documentation when the docs describe authentication, scopes, and requests. It cannot connect an arbitrary website. Providers differ, and some do not offer an API.";

export interface ConnectorSource {
  key?: unknown;
  title?: unknown;
  builtin?: unknown;
  state?: unknown;
  actions?: unknown;
  secrets?: unknown;
}

export interface ShownConnector {
  key: string;
  title: string;
  level: TrustLevel;
  label: string;
  actions: string[];
}

export function levelOf(row: { builtin?: unknown; state?: unknown }): TrustLevel {
  if (row.builtin === true) return "built_in";
  if (row.state === "live") return "space_published";
  return "draft";
}

export function visibleInPalette(level: TrustLevel, audience: "author" | "space"): boolean {
  if (level === "draft" || level === "private_verified") return audience === "author";
  return level === "space_published" || level === "built_in";
}

export function levelLabel(row: { builtin?: unknown; state?: unknown }): string {
  if (row.builtin === true) return "Built-in";
  if (row.state === "live") return "Published in this Space";
  if (row.state === "failing_tests") return "Draft, tests failed";
  return "Draft";
}

function actionsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

/** Drops secret names and secret values. A row without a key is not shown. */
export function shownConnectors(rows: readonly ConnectorSource[], audience: "author" | "space"): ShownConnector[] {
  const out: ShownConnector[] = [];
  for (const row of rows) {
    if (typeof row.key !== "string" || row.key.length === 0) continue;
    const level = levelOf(row);
    if (!visibleInPalette(level, audience)) continue;
    out.push({
      key: row.key,
      title: typeof row.title === "string" && row.title.length > 0 ? row.title : row.key,
      level,
      label: levelLabel(row),
      actions: actionsOf(row.actions),
    });
  }
  return out;
}

export function connectorLine(row: ShownConnector): string {
  const actions = row.actions.length > 0 ? row.actions.join(", ") : "no actions yet";
  return `${row.title} · ${row.label} · ${actions}`;
}
