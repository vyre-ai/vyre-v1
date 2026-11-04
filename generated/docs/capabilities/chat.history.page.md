# chat.history.page

Older messages and tool calls of THIS chat before a given message number, at most 100 at a time, oldest first inside the page; the agent reads further back than the window it was given. It refuses any other chat than the one the agent is working in

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
| HTTP | POST /v1/chat/history/page |
| MCP tool | chat_history_page (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  before: number;
  limit?: number;
};
```

## Output

```ts
type Out = {
  messages: Array<{
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
      paidBy?: string;
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
    }>;
  hasMore: boolean;
  next?: number;
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
    "before": 1,
    "limit": 1,
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "hasMore": true,
    "messages": [
      {
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
        "paidBy": "usr_a1b2c3",
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
    ],
    "next": 1
  }
}
```
