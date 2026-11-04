# chat.noted

The quiet line memory leaves in a place other people share when it remembers something: "Noted: decision, go with Harbor" with Undo. One link-card line; Undo is memory.undo on the fact

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | low |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chat/noted |
| MCP tool | chat_noted (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  factId: string;
  kind: string;
  text: string;
  replaces?: string;
  disputed?: boolean;
};
```

## Output

```ts
type Out = {
  posted: boolean;
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
    "disputed": true,
    "factId": "fct_a1b2c3",
    "kind": "example",
    "replaces": "fct_a1b2c3",
    "text": "example",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "posted": true
  }
}
```
