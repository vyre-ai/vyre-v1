# chat.catch_up

What you missed in a thread since you last read it: counts, who wrote, tasks and decisions that landed, and messages with an @ in them. A plain read, kept until something new arrives

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chat/catch_up |
| MCP tool | chat_catch_up (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
};
```

## Output

```ts
type Out = {
  unread: number;
  since: number;
  top: number;
  firstMessageId?: string;
  people: Array<{
      id: string;
      count: number;
    }>;
  tasks: Array<{
      messageId: string;
      title: string;
    }>;
  decisions: Array<{
      messageId: string;
      text: string;
    }>;
  at: Array<{
      messageId: string;
      author: string;
      text: string;
    }>;
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
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "at": [
      {
        "author": "example",
        "messageId": "msg_a1b2c3",
        "text": "example"
      }
    ],
    "decisions": [
      {
        "messageId": "msg_a1b2c3",
        "text": "example"
      }
    ],
    "firstMessageId": "msg_a1b2c3",
    "people": [
      {
        "count": 1,
        "id": "example"
      }
    ],
    "since": 1,
    "tasks": [
      {
        "messageId": "msg_a1b2c3",
        "title": "example"
      }
    ],
    "top": 1,
    "unread": 1
  }
}
```
