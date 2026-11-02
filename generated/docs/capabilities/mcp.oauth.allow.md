# mcp.oauth.allow

A person allows an app to join: it becomes an agent they own, acting for them, and only the tab that asked can collect the sign-in

| | |
|---|---|
| Module | mcp |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mcp/oauth/allow |
| MCP tool | none |
| CLI | none |
| Emits | mcp.client_allowed |

## Input

```ts
type In = {
  requestId: string;
};
```

## Output

```ts
type Out = {
  agentId: string;
  name: string;
};
```

## Errors

- auth.expired
- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "requestId": "oar_a1b2c3"
  },
  "output": {
    "agentId": "agt_a1b2c3",
    "name": "example"
  }
}
```
