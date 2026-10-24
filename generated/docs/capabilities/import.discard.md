# import.discard

Drop a staged import before it is committed

| | |
|---|---|
| Module | import |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.create |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/import/discard |
| MCP tool | import_discard (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  importId: string;
};
```

## Output

```ts
type Out = {
  discarded: boolean;
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
    "importId": "imp_a1b2c3"
  },
  "output": {
    "discarded": true
  }
}
```
