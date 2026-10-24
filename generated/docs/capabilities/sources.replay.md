# sources.replay

Process a failed delivery again after fixing the mapping

| | |
|---|---|
| Module | sources |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sources/replay |
| MCP tool | sources_replay (records) |
| CLI | none |
| Emits | source.received, source.mapping_failed |

## Input

```ts
type In = {
  deliveryId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  status: "accepted" | "duplicate" | "rejected" | "failed";
  recordIds: Array<string>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "deliveryId": "dlv_a1b2c3",
    "idempotencyKey": "idem_1"
  },
  "output": {
    "recordIds": [
      "rec_a1b2c3"
    ],
    "status": "accepted"
  }
}
```
