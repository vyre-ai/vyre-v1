# notes.delete

Delete a note. It can come back with notes.restore (Undo). Someone it was shared with only removes it from their own notes

| | |
|---|---|
| Module | notes |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | patch |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/notes/delete |
| MCP tool | none |
| CLI | none |
| Emits | notes.deleted |

## Input

```ts
type In = {
  noteId: string;
};
```

## Output

```ts
type Out = {
  deleted: boolean;
  undo: {
    noteId: string;
  };
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
    "noteId": "nte_a1b2c3"
  },
  "output": {
    "deleted": true,
    "undo": {
      "noteId": "nte_a1b2c3"
    }
  }
}
```
