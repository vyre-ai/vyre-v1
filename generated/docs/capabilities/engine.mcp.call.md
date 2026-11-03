# engine.mcp.call

Call a tool of an outside tool server or connection (app hub, OAuth server, remote MCP) that may change things, as mcp_tools lists it; an agent's call goes through the Gate

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | space |
| Gate | send when actor.kind != 'person' |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/engine/mcp/call |
| MCP tool | mcp_call (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId: string;
  server: string;
  tool: string;
  input?: unknown;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  isError: boolean;
  text: string;
  structured?: unknown;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.network
- provider.unavailable
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "idempotencyKey": "idem_1",
    "input": {},
    "server": "greeter/echo",
    "tool": "example"
  },
  "output": {
    "isError": true,
    "structured": {},
    "text": "example"
  }
}
```
