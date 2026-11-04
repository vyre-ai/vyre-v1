# memory.place.list

Knows tab: what Vyre remembers in one place (chat, channel, project, task, goal or record), each with its kind, state, who said it, the message and the words it came from; only what the caller may open. Edit and Remove show where canEdit is true

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
