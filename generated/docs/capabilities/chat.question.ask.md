# chat.question.ask

Ask the person a structured question (single, multi or free text); the turn parks until it is answered

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
| HTTP | POST /v1/chat/question/ask |
| MCP tool | ask_question (chats) |
| CLI | none |
| Emits | message.received, block.waiting |

## Input

```ts
type In = {
  threadId: string;
  prompt: string;
  mode: "single" | "multi" | "free";
  options?: Array<{
      key: string;
      label: string;
      detail?: string;
    }>;
  allowOther?: boolean;
};
```

## Output

```ts
type Out = {
  blockId: string;
  messageId: string;
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
    "allowOther": true,
    "mode": "single",
    "options": [
      {
        "detail": "example",
        "key": "example",
        "label": "example"
      }
    ],
    "prompt": "example",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "blockId": "blk_a1b2c3",
    "messageId": "msg_a1b2c3"
  }
}
```
