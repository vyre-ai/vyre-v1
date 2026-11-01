# engine.mcp.oauth_complete

Finish an OAuth sign-in with the state and code the server sent back, or the error it sent when the person declined. Only the person who started it can finish it.

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/engine/mcp/oauth_complete |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  state: string;
  code?: string;
  error?: string;
};
```

## Output

```ts
type Out = {
  connectionId: string;
};
```

## Errors

- auth.invalid_code
- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "code": "example",
    "error": "example",
    "state": "example"
  },
  "output": {
    "connectionId": "example"
  }
}
```
