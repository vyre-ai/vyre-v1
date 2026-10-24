# mcp.session.close

Close an MCP session

| | |
|---|---|
| Module | mcp |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mcp/session/close |
| MCP tool | mcp_session_close (engineer) |
| CLI | none |
| Emits | mcp.session_ended |

## Input

```ts
type In = {
  sessionId: string;
};
```

## Output

```ts
type Out = {
  closed: boolean;
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
    "sessionId": "ses_a1b2c3"
  },
  "output": {
    "closed": true
  }
}
```
