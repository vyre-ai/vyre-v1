# connections.pause

The owner pauses a connection; syncing and actions stop

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | medium |
| Resource | connection (/connectionId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/connections/pause |
| MCP tool | connections_pause (engineer) |
| CLI | none |
| Emits | connection.paused |

## Input

```ts
type In = {
  connectionId: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "ok": true
  }
}
```
