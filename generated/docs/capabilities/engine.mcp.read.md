# engine.mcp.read

Call a tool of an outside tool server or connection (app hub, OAuth server, remote MCP) that only reads, as mcp_tools lists it with readOnly true; a tool that may change things goes through mcp_call

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | use |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/mcp/read |
| MCP tool | mcp_read (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId: string;
  server: string;
  tool: string;
  input?: unknown;
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
