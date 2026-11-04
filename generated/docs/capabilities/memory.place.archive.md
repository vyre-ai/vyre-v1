# memory.place.archive

A place was archived or deleted: its memory is archived (restorable by an admin) or deleted with it. Whoever may edit the place's memory, or an admin

| | |
|---|---|
| Module | memory |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/memory/place/archive |
| MCP tool | memory_place_archive (memory) |
| CLI | none |
| Emits | memory.removed |

## Input

```ts
type In = {
  placeKind: "chat" | "channel" | "project" | "task" | "goal" | "record";
  placeId: string;
  action: "archive" | "delete";
};
```

## Output

```ts
type Out = {
  facts: number;
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
    "action": "archive",
    "placeId": "example",
    "placeKind": "chat"
  },
  "output": {
    "facts": 1
  }
}
```
