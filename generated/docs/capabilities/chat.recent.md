# chat.recent

Sidebar Recent: Starred, Today, Yesterday, Earlier with unread counts and the working pulse, then the chats I archived (they are in no other group)

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chat/recent |
| MCP tool | chat_recent (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  filter?: "all" | "unread" | "people" | "agents";
};
```

## Output

```ts
type Out = {
  starred: Array<{
      threadId: string;
      kind: "chat" | "channel" | "thread" | "ask" | "run" | "helper" | "console";
      title: string;
      agents: Array<string>;
      unread: number;
      repliesUnread?: number;
      working: boolean;
      starred: boolean;
      lastAt: number;
      preview?: string;
      people?: Array<string>;
    }>;
  today: Array<{
      threadId: string;
      kind: "chat" | "channel" | "thread" | "ask" | "run" | "helper" | "console";
      title: string;
      agents: Array<string>;
      unread: number;
      repliesUnread?: number;
      working: boolean;
      starred: boolean;
      lastAt: number;
      preview?: string;
      people?: Array<string>;
    }>;
  yesterday: Array<{
      threadId: string;
      kind: "chat" | "channel" | "thread" | "ask" | "run" | "helper" | "console";
      title: string;
      agents: Array<string>;
      unread: number;
      repliesUnread?: number;
      working: boolean;
      starred: boolean;
      lastAt: number;
      preview?: string;
      people?: Array<string>;
    }>;
  earlier: Array<{
      threadId: string;
      kind: "chat" | "channel" | "thread" | "ask" | "run" | "helper" | "console";
      title: string;
      agents: Array<string>;
      unread: number;
      repliesUnread?: number;
      working: boolean;
      starred: boolean;
      lastAt: number;
      preview?: string;
      people?: Array<string>;
    }>;
  archived: Array<{
      threadId: string;
      kind: "chat" | "channel" | "thread" | "ask" | "run" | "helper" | "console";
      title: string;
      agents: Array<string>;
      unread: number;
      repliesUnread?: number;
      working: boolean;
      starred: boolean;
      lastAt: number;
      preview?: string;
      people?: Array<string>;
    }>;
  nextUnread: string | null;
  threadsUnread?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "filter": "all"
  },
  "output": {
    "archived": [
      {
        "agents": [
          "agt_a1b2c3"
        ],
        "kind": "chat",
        "lastAt": 1760000000000,
        "people": [
          "usr_a1b2c3"
        ],
        "preview": "example",
        "repliesUnread": 1,
        "starred": true,
        "threadId": "thr_a1b2c3",
        "title": "example",
        "unread": 1,
        "working": true
      }
    ],
    "earlier": [
      {
        "agents": [
          "agt_a1b2c3"
        ],
        "kind": "chat",
        "lastAt": 1760000000000,
        "people": [
          "usr_a1b2c3"
        ],
        "preview": "example",
        "repliesUnread": 1,
        "starred": true,
        "threadId": "thr_a1b2c3",
        "title": "example",
        "unread": 1,
        "working": true
      }
    ],
    "nextUnread": "thr_a1b2c3",
    "starred": [
      {
        "agents": [
          "agt_a1b2c3"
        ],
        "kind": "chat",
        "lastAt": 1760000000000,
        "people": [
          "usr_a1b2c3"
        ],
        "preview": "example",
        "repliesUnread": 1,
        "starred": true,
        "threadId": "thr_a1b2c3",
        "title": "example",
        "unread": 1,
        "working": true
      }
    ],
    "threadsUnread": 1,
    "today": [
      {
        "agents": [
          "agt_a1b2c3"
        ],
        "kind": "chat",
        "lastAt": 1760000000000,
        "people": [
          "usr_a1b2c3"
        ],
        "preview": "example",
        "repliesUnread": 1,
        "starred": true,
        "threadId": "thr_a1b2c3",
        "title": "example",
        "unread": 1,
        "working": true
      }
    ],
    "yesterday": [
      {
        "agents": [
          "agt_a1b2c3"
        ],
        "kind": "chat",
        "lastAt": 1760000000000,
        "people": [
          "usr_a1b2c3"
        ],
        "preview": "example",
        "repliesUnread": 1,
        "starred": true,
        "threadId": "thr_a1b2c3",
        "title": "example",
        "unread": 1,
        "working": true
      }
    ]
  }
}
```
