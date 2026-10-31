# sync_specs.remove

Stop syncing an app into Records and remove its connector and connection; keep its records as plain records, or remove them with their types (a copy waits in Trash for 30 days)

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | record_type (/type) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/sync_specs/remove |
| MCP tool | sync_specs_remove (records) |
| CLI | none |
| Emits | sync.type_native, connection.deleted, connector.removed, schema.changed, schema.type_dropped |

## Input

```ts
type In = {
  type: string;
  records: "keep" | "remove";
};
```

## Output

```ts
type Out = {
  detached: Array<string>;
  removed: Array<string>;
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
    "records": "keep",
    "type": "contact"
  },
  "output": {
    "detached": [
      "contact"
    ],
    "removed": [
      "contact"
    ]
  }
}
```
