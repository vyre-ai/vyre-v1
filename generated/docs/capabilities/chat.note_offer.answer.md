# chat.note_offer.answer

Save or dismiss an offer to keep something from this chat as a note. Save makes the person's own private note that links back to the message

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chat/note_offer/answer |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  blockId: string;
  decision: "save" | "dismiss";
};
```

## Output

```ts
type Out = {
  state: "saved" | "dismissed";
  noteId?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "blockId": "blk_a1b2c3",
    "decision": "save",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "noteId": "example",
    "state": "saved"
  }
}
```
