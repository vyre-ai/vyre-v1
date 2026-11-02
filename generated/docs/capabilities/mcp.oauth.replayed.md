# mcp.oauth.replayed

System: a used code or refresh token came back, so that sign-in ended

| | |
|---|---|
| Module | mcp |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mcp/oauth/replayed |
| MCP tool | none |
| CLI | none |
| Emits | mcp.client_replayed |

## Input

```ts
type In = {
  agentId: string;
  person: string;
  why: string;
};
```

## Output

```ts
type Out = {
  noted: boolean;
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
    "agentId": "agt_a1b2c3",
    "person": "example",
    "why": "example"
  },
  "output": {
    "noted": true
  }
}
```
