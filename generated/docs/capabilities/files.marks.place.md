# files.marks.place

A redaction a new version could not carry over: place it on a near match, or drop it

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
| HTTP | POST /v1/files/marks/place |
| MCP tool | none |
| CLI | none |
| Emits | file.redacted, file.unredacted |

## Input

```ts
type In = {
  markId: string;
  text?: string;
  drop?: boolean;
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

## Example

```json
{
  "name": "example",
  "input": {
    "drop": true,
    "markId": "mrk_a1b2c3",
    "text": "example"
  },
  "output": {
    "ok": true
  }
}
```
