# chat.make_task

Turn a message into a task: the title is its first line, the task points back at it and a "Task created" card in the thread links to the task. An agent may do it for the person it acts for

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
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chat/make_task |
| MCP tool | chat_make_task (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  messageId: string;
  title?: string;
  assigneeId?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  taskId: string;
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
    "assigneeId": "example",
    "idempotencyKey": "idem_1",
    "messageId": "msg_a1b2c3",
    "threadId": "thr_a1b2c3",
    "title": "example"
  },
  "output": {
    "messageId": "msg_a1b2c3",
    "taskId": "tsk_a1b2c3"
  }
}
```
