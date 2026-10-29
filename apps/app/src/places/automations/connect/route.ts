// Where Connect goes. The service comes from a structured field, never from the wording of an error.
export interface ConnectTarget {
  service: string;
  connectionId?: string;
  connectionState?: string;
  kind?: "connection" | "key";
}

export interface SetupIssue {
  nodeId?: string;
  message?: string;
  service?: unknown;
  connector?: unknown;
  connectionId?: unknown;
  connectionState?: unknown;
  requirement?: unknown;
  setupAction?: unknown;
}

export interface SetupResult {
  connect?: ConnectTarget;
  /** Shown when the issue names no service. Connect is not offered. */
  blocked?: string;
}

function text(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

function record(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
}

/** A structured service, connector, or requirement. Message text is ignored. */
export function setupFromIssue(issue: SetupIssue): SetupResult {
  const req = record(issue.requirement);
  const service = text(issue.service) ?? text(issue.connector) ?? text(req?.["service"]) ?? text(req?.["connector"]);
  const connectionId = text(issue.connectionId) ?? text(req?.["connectionId"]);
  const connectionState = text(issue.connectionState) ?? text(req?.["connectionState"]);
  const kind = text(req?.["kind"]) === "key" || text(issue.setupAction) === "key" ? "key" : "connection";
  if (service) {
    return { connect: { service, kind, ...(connectionId ? { connectionId } : {}), ...(connectionState ? { connectionState } : {}) } };
  }
  const step = issue.nodeId ? `Step ${issue.nodeId} is blocked` : "A step is blocked";
  return { blocked: issue.message ? `${step}. ${issue.message}` : step };
}

/** The connection screen for that service. Mail stays on mail connections. Everything else uses the integrations screen. Keys open the provider screen. */
export function connectionRoute(target: ConnectTarget): { screen: string; args: Record<string, unknown> } {
  if (target.kind === "key") return { screen: "vault.providers", args: { service: target.service } };
  const args: Record<string, unknown> = { service: target.service };
  if (target.connectionId) args["connectionId"] = target.connectionId;
  if (target.connectionState) args["connectionState"] = target.connectionState;
  if (/^(mail|email|gmail|mailbox)$/i.test(target.service)) return { screen: "mail.connections", args };
  return { screen: "console.integrations", args: { ...args, connector: target.service } };
}
