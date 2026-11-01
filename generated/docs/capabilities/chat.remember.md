# chat.remember

Remember a message as a fact in the memory of the project this chat belongs to (else your own), sourced to the message; a "Remembered for ..." card in the thread links to the fact. A shared layer keeps its review rule

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
| HTTP | POST /v1/chat/remember |
| MCP tool | chat_remember (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  messageId: string;
  text?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  factId: string;
  layer: "project" | "person";
  merged: boolean;
  projectId?: string;
  projectTitle?: string;
  by: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.provider_label
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "messageId": "msg_a1b2c3",
    "text": "example",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "by": "example",
    "factId": "fct_a1b2c3",
    "layer": "project",
    "merged": true,
    "projectId": "prj_a1b2c3",
    "projectTitle": "example"
  }
}
```
