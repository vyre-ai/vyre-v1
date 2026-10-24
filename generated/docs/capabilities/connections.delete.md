# connections.delete

Remove a connection; synced types bound to it pause

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
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/connections/delete |
| MCP tool | connections_delete (engineer) |
| CLI | none |
| Emits | connection.deleted |

## Input

```ts
type In = {
  connectionId: string;
};
```

## Output

```ts
type Out = {
  deleted: boolean;
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
    "deleted": true
  }
}
```
