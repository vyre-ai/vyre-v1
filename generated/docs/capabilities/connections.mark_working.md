# connections.mark_working

System: another module proved this connection works (Google delegation passed its check, or a mailbox or calendar poll succeeded). A pending, failing or signed-out connection becomes active, and its last used time is stamped at most once a minute. A paused one stays paused

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/connections/mark_working |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
};
```

## Output

```ts
type Out = {
  state: "pending" | "active" | "failing" | "needs_reconnect" | "paused";
  stamped: boolean;
};
```

## Errors

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
    "connectionId": "con_a1b2c3"
  },
  "output": {
    "stamped": true,
    "state": "pending"
  }
}
```
