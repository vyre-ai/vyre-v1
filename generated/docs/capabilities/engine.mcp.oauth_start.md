# engine.mcp.oauth_start

Begin signing a remote outside-tool connection in with OAuth (the MCP authorization flow). Answers the address to send the person to; the token that comes back is sealed and never answered.

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | agents.manage |
| Grant level | manage |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/engine/mcp/oauth_start |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  redirectUri: string;
};
```

## Output

```ts
type Out = {
  authUrl: string;
  state: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.unavailable
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "connectionId": "example",
    "redirectUri": "example"
  },
  "output": {
    "authUrl": "example",
    "state": "example"
  }
}
```
