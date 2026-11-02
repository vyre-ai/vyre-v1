# mcp.oauth.decline

A person says no to an app that asked to join

| | |
|---|---|
| Module | mcp |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mcp/oauth/decline |
| MCP tool | none |
| CLI | none |
| Emits | mcp.client_declined |

## Input

```ts
type In = {
  requestId: string;
};
```

## Output

```ts
type Out = {
  declined: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "requestId": "oar_a1b2c3"
  },
  "output": {
    "declined": true
  }
}
```
