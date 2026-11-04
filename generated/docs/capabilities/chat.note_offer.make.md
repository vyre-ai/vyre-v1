# chat.note_offer.make

Offer to save something from this chat as a note: a small card with a preview of the note, Save and Not now. At most once per topic and rarely; says offered false with a reason when the person has it off or it is too soon

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
| HTTP | POST /v1/chat/note_offer/make |
| MCP tool | offer_note (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  title: string;
  body: string;
  topic: string;
  messageId?: string;
};
```

## Output

```ts
type Out = {
  offered: boolean;
  why?: "off" | "already_offered" | "too_soon" | "declined_recently";
  blockId?: string;
  messageId?: string;
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
    "body": "example",
    "messageId": "msg_a1b2c3",
    "threadId": "thr_a1b2c3",
    "title": "example",
    "topic": "example"
  },
  "output": {
    "blockId": "blk_a1b2c3",
    "messageId": "msg_a1b2c3",
    "offered": true,
    "why": "off"
  }
}
```
