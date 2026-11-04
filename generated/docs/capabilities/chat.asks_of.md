# chat.asks_of

Ask panes opened on one object (the pane history of a record, file, event, page, site or automation)

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chat/asks_of |
| MCP tool | chat_asks_of (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  resourceType: string;
  resourceId: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  threads: Array<{
      threadId: string;
      kind: "chat" | "channel" | "thread" | "ask" | "run" | "helper" | "console";
      title?: string;
      starter?: string;
      channelId?: string;
      parentThreadId?: string;
      parentMessageId?: string;
      recordId?: string;
      folderId?: string;
      scopeType?: string;
      scopeId?: string;
      listed: boolean;
      planMode: boolean;
      mode?: "ask" | "auto" | "plan";
      members: Array<{
          kind: "person" | "agent" | "actor" | "service";
          id: string;
        }>;
      agents: Array<{
          agentId: string;
          mode: "lead" | "listen";
          model?: string;
          provider?: string;
          effort?: "low" | "medium" | "high" | "max";
          accountRef?: string;
          watches?: boolean;
          when?: "always" | "topics" | "hours";
          topics?: string;
          hoursFrom?: string;
          hoursTo?: string;
          style?: "short" | "full";
          quiet?: boolean;
          owned?: boolean;
        }>;
      createdAt: number;
      closedAt?: number;
      joinedAt?: Record<string, unknown>;
      sharedAt?: number;
      replyCount?: number;
      lastMessageAt?: number;
      path?: Array<{
          title: string;
          threadId: string;
        }>;
      unread?: number;
      following?: boolean;
      muted?: boolean;
      repliers?: Array<{
          kind: "person" | "agent" | "actor" | "service";
          id: string;
        }>;
      parentTitle?: string;
      preview?: string;
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "limit": 1,
    "resourceId": "example",
    "resourceType": "record"
  },
  "output": {
    "next": "example",
    "threads": [
      {
        "agents": [
          {
            "accountRef": "example",
            "agentId": "agt_a1b2c3",
            "effort": "low",
            "hoursFrom": "09:00",
            "hoursTo": "09:00",
            "mode": "lead",
            "model": "claude-sonnet-5-5",
            "owned": true,
            "provider": "anthropic",
            "quiet": true,
            "style": "short",
            "topics": "example",
            "watches": true,
            "when": "always"
          }
        ],
        "channelId": "chn_a1b2c3",
        "closedAt": 1760000000000,
        "createdAt": 1760000000000,
        "folderId": "fld_a1b2c3",
        "following": true,
        "joinedAt": {},
        "kind": "chat",
        "lastMessageAt": 1760000000000,
        "listed": true,
        "members": [
          {
            "id": "usr_a1b2c3",
            "kind": "person"
          }
        ],
        "mode": "ask",
        "muted": true,
        "parentMessageId": "msg_a1b2c3",
        "parentThreadId": "thr_a1b2c3",
        "parentTitle": "example",
        "path": [
          {
            "threadId": "thr_a1b2c3",
            "title": "example"
          }
        ],
        "planMode": true,
        "preview": "example",
        "recordId": "rec_a1b2c3",
        "repliers": [
          {
            "id": "usr_a1b2c3",
            "kind": "person"
          }
        ],
        "replyCount": 1,
        "scopeId": "example",
        "scopeType": "record",
        "sharedAt": 1760000000000,
        "starter": "example",
        "threadId": "thr_a1b2c3",
        "title": "example",
        "unread": 1
      }
    ],
    "total": 1
  }
}
```
