# chat.helper.notes

The notes in a helper chat with who sent each: the person, the agent that started it, or the helper

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
| HTTP | POST /v1/chat/helper/notes |
| MCP tool | chat_helper_notes (chats) |
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
  notes: Array<{
      messageId: string;
      authorId: string;
      who: "brief" | "person" | "parent" | "helper";
      body: string;
      kind?: string;
      state?: string;
      seenAt?: number;
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
    "notes": [
      {
        "authorId": "example",
        "body": "example",
        "kind": "example",
        "messageId": "msg_a1b2c3",
        "seenAt": 1760000000000,
        "state": "example",
        "who": "brief"
      }
    ]
  }
}
```
