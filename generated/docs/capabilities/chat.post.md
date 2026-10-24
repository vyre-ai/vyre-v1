# chat.post

Post a message in a thread or channel; routes to the lead agent or @mentioned agents and records mentions

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
| Idempotency | key |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chat/post |
| MCP tool | chat_post (chats) |
| CLI | vyre chat post |
| Emits | message.received, message.mentioned, message.direct, thread.replied |

## Input

```ts
type In = {
  threadId: string;
  body: string;
  blocks?: Array<{
      type: string;
      v: number;
      data: unknown;
    }>;
  attachments?: Array<string>;
  replyTo?: string;
  mentions?: Array<{
      kind: "person" | "agent";
      id: string;
    }>;
  via?: {
    routineOwner: string;
  };
  clientId?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  message: {
    messageId: string;
    threadId: string;
    threadSeq: number;
    author: {
      kind: "person" | "agent" | "actor" | "service";
      id: string;
    };
    kind: "text" | "agent" | "system" | "quiet";
    body: string;
    blocks: Array<{
        type: string;
        v: number;
        id: string;
        data: unknown;
        state?: "live" | "done" | "waiting" | "error";
        traceId: string;
      }>;
    replyTo?: string;
    via?: {
      routineOwner: string;
    };
    depth: number;
    attachments: Array<string>;
    reactions: Array<{
        emoji: string;
        by: Array<string>;
      }>;
    pinned: boolean;
    editedAt?: number;
    createdAt: number;
    enc?: number;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.limit
- permission.no_grant
- permission.plan_mode
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "attachments": [
      "fil_a1b2c3"
    ],
    "blocks": [
      {
        "data": {},
        "type": "example",
        "v": 1
      }
    ],
    "body": "example",
    "clientId": "msg_a1b2c3",
    "idempotencyKey": "idem_1",
    "mentions": [
      {
        "id": "usr_a1b2c3",
        "kind": "person"
      }
    ],
    "replyTo": "msg_a1b2c3",
    "threadId": "thr_a1b2c3",
    "via": {
      "routineOwner": "usr_a1b2c3"
    }
  },
  "output": {
    "message": {
      "attachments": [
        "fil_a1b2c3"
      ],
      "author": {
        "id": "usr_a1b2c3",
        "kind": "person"
      },
      "blocks": [
        {
          "data": {},
          "id": "blk_a1b2c3",
          "state": "live",
          "traceId": "0123456789abcdef0123456789abcdef",
          "type": "record_card",
          "v": 1
        }
      ],
      "body": "example",
      "createdAt": 1760000000000,
      "depth": 1,
      "editedAt": 1760000000000,
      "enc": 1,
      "kind": "text",
      "messageId": "msg_a1b2c3",
      "pinned": true,
      "reactions": [
        {
          "by": [
            "example"
          ],
          "emoji": "thumbs_up"
        }
      ],
      "replyTo": "msg_a1b2c3",
      "threadId": "thr_a1b2c3",
      "threadSeq": 1,
      "via": {
        "routineOwner": "usr_a1b2c3"
      }
    }
  }
}
```
