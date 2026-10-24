# conflicts.log_binary

Record a binary file conflict: the newest save stays current and the other becomes a labelled version with a Conflicts row

| | |
|---|---|
| Module | conflicts |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/conflicts/log_binary |
| MCP tool | none |
| CLI | none |
| Emits | conflict.binary_logged |

## Input

```ts
type In = {
  fileId: string;
  currentVersionId: string;
  otherVersionId: string;
  label: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  conflictId: string;
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
    "currentVersionId": "ver_a1b2c3",
    "fileId": "fil_a1b2c3",
    "idempotencyKey": "idem_1",
    "label": "example",
    "otherVersionId": "ver_a1b2c3"
  },
  "output": {
    "conflictId": "cfl_a1b2c3"
  }
}
```
