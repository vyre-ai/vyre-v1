# chat.message_person

Message a teammate for the person you work for, in their direct chat, signed as them (Agent); the reply comes back to this chat. Can carry an approval, review or key card. Waits for away and after hours unless urgent; 3 an hour

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | send when actor.kind != 'person' |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/chat/message_person |
| MCP tool | message_person (chats, deferred) |
| CLI | none |
| Emits | thread.started, message.received, message.direct, message.mentioned, thread.replied, thread.unarchived |

## Input

```ts
type In = {
  to: string;
  body: string;
  timing?: "now" | "online" | "at";
  at?: number;
  urgent?: boolean;
  card?: {
    kind: "approval" | "review" | "key";
    title: string;
    detail?: string;
    fields?: Array<string>;
  };
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  state: "sent" | "scheduled";
  threadId: string;
  messageId?: string;
  dueAt?: number;
  when: string;
  taskId?: string;
  requestId?: string;
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
    "at": 1760000000000,
    "body": "example",
    "card": {
      "detail": "example",
      "fields": [
        "example"
      ],
      "kind": "approval",
      "title": "example"
    },
    "idempotencyKey": "idem_1",
    "timing": "now",
    "to": "usr_a1b2c3",
    "urgent": true
  },
  "output": {
    "dueAt": 1760000000000,
    "messageId": "msg_a1b2c3",
    "requestId": "example",
    "state": "sent",
    "taskId": "tsk_a1b2c3",
    "threadId": "thr_a1b2c3",
    "when": "example"
  }
}
```
