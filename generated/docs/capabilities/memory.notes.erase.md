# memory.notes.erase

Erase one memory note for good, with its graph node and links (governance erase)

| | |
|---|---|
| Module | memory |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | policy.manage |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/memory/notes/erase |
| MCP tool | none |
| CLI | none |
| Emits | note.erased |

## Input

```ts
type In = {
  noteId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  erased: boolean;
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
    "idempotencyKey": "idem_1",
    "noteId": "not_a1b2c3"
  },
  "output": {
    "erased": true
  }
}
```
