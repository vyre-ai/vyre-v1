# chat.react

Add or remove a reaction

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
| Offline | patch |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chat/react |
| MCP tool | chat_react (chats) |
| CLI | none |
| Emits | message.reacted |

## Input

```ts
type In = {
  messageId: string;
  threadId: string;
  emoji: string;
  remove?: boolean;
};
```

## Output

```ts
type Out = {
  reactions: Array<{
      emoji: string;
      by: Array<string>;
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
    "emoji": "example",
    "messageId": "msg_a1b2c3",
    "remove": true,
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "reactions": [
      {
        "by": [
          "example"
        ],
        "emoji": "thumbs_up"
      }
    ]
  }
}
```
