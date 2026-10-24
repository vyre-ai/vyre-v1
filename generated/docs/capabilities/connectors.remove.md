# connectors.remove

Remove a connector and its connections

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | connector (/key) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/connectors/remove |
| MCP tool | connectors_remove (engineer) |
| CLI | none |
| Emits | connector.removed, connection.deleted |

## Input

```ts
type In = {
  key: string;
};
```

## Output

```ts
type Out = {
  removed: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "key": "hubspot"
  },
  "output": {
    "removed": true
  }
}
```
