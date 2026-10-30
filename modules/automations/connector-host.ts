// The host's way to fill a Vault field and to reach a host with the address guard. It is the same port the connectors module uses.
// The module never opens a socket. A key value comes back from fill once, stays in memory for one request, and is scrubbed from the reply.

export interface CallerCtx {
  space: string;
  principal: { kind: string; id: string };
  actingFor?: string;
  trace: { traceId: string; spanId: string };
  depth: number;
  call(cap: "vault.fill", input: unknown): Promise<unknown>;
  rememberVaultItem?(id: string): void;
  assertAuthorized?(): void;
}

export interface FillBinding { connector: string; connectionId: string; slot: string; handle: string }

export interface ConnectorCallHost {
  fill(caller: CallerCtx, binding: FillBinding): Promise<string>;
  http(caller: CallerCtx, domains: readonly string[], url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; text(): Promise<string>; retryAfter?: string }>;
}

let current: ConnectorCallHost | null = null;

export function setConnectorCallHost(next: ConnectorCallHost | null): void {
  current = next;
}
export function connectorCallHost(): ConnectorCallHost | null {
  return current;
}
