# memory.place.list

Knows tab: what Vyre remembers in one place, each with kind, state, who said it, the message and words; with linked places (scope linked) and Space markers (scope space) the caller may open. canEdit says whether Edit and Remove show

| | |
|---|---|
| Module | memory |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/memory/place/list |
| MCP tool | memory_place_list (memory) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  placeKind: "chat" | "channel" | "project" | "task" | "goal" | "record";
  placeId: string;
  history?: boolean;
};
```

## Output

```ts
type Out = {
  facts: Array<unknown>;
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
    "history": true,
    "placeId": "example",
    "placeKind": "chat"
  },
  "output": {
    "facts": [
      {}
    ]
  }
}
```
