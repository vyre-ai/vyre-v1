// Connector breadth. Schema text and tool descriptions are data, not instructions.
// A shared definition keeps the app name and actions. It drops vault ids and key values.

export interface NamedAction {
  key: string;
  title: string;
  level: "draft" | "tested";
}

export interface McpTool {
  name: string;
  description?: string;
}

export interface ConnectorDefinition {
  appName: string;
  actions: readonly NamedAction[];
  vaultItemId?: string;
  keyValue?: string;
}

/** Docs text is not parsed. The action list is returned unchanged. */
export function actionsFromSchema(actions: readonly NamedAction[], docsText: string): readonly NamedAction[] {
  void docsText;
  return actions;
}

function actionKey(title: string): string {
  return title.toLowerCase().replace(/ /g, "-").replace(/[^a-z0-9-]/g, "");
}

/** One draft action per named tool. Descriptions are not extra actions. Nothing is fetched. */
export function actionsFromMcpTools(app: string, tools: readonly McpTool[]): NamedAction[] {
  const name = app.trim();
  const actions: NamedAction[] = [];
  for (const tool of tools) {
    if (tool.name.trim() === "") continue;
    const title = `${name}: ${tool.name}`;
    actions.push({ key: actionKey(title), title, level: "draft" });
  }
  return actions;
}

/** Copy the app name and actions. Vault ids and key values stay out of the copy. */
export function shareWithoutKeys(def: ConnectorDefinition): { appName: string; actions: readonly NamedAction[] } {
  return {
    appName: def.appName,
    actions: def.actions.map((action) => ({ key: action.key, title: action.title, level: action.level })),
  };
}

/** A drafted action stays unpublished. A tested action may be published. */
export function publishAllowed(level: "draft" | "tested"): { ok: true } | { ok: false; reason: string } {
  if (level === "tested") return { ok: true };
  return { ok: false, reason: "A drafted action cannot be published." };
}
