# engine.mcp.read

Call an outside MCP tool that only reads (the server says so); runs in the sandbox or at the remote server

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
| MCP tool | none |
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
