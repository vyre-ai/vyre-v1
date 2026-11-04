# chat.helper.note

Note between a helper and the agent that started it: a follow-up down, progress, a result or a question up. Set needsPerson only when no one but the person can answer

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
| HTTP | POST /v1/chat/helper/note |
| MCP tool | helper_note (chats, deferred) |
| CLI | none |
| Emits | helper.note, message.received, block.waiting, message.direct, message.mentioned, thread.replied, thread.unarchived |

## Input

```ts
type In = {
  threadId: string;
  body: string;
  kind?: "followup" | "progress" | "question" | "result";
  needsPerson?: boolean;
  options?: Array<{
      key: string;
      label: string;
    }>;
};
```

## Output

```ts
type Out = {
  messageId: string;
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
    "body": "example",
    "kind": "followup",
    "needsPerson": true,
    "options": [
      {
        "key": "example",
        "label": "example"
      }
    ],
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "messageId": "msg_a1b2c3"
  }
}
```
