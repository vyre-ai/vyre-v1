# files.marks.remove

Un-redact or remove a highlight; only a person takes a redaction off

| | |
|---|---|
| Module | files |
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
| HTTP | POST /v1/files/marks/remove |
| MCP tool | none |
| CLI | none |
| Emits | file.unredacted, file.highlight_removed |

## Input

```ts
type In = {
  markId: string;
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
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "markId": "mrk_a1b2c3"
  },
  "output": {
    "removed": true
  }
}
```
