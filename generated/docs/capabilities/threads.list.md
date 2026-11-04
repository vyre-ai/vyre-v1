# threads.list

List threads by kind, folder, scope or record; or the threads I am in, newest reply first

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
| HTTP | POST /v1/threads/list |
| MCP tool | threads_list (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  kind?: Array<"chat" | "channel" | "thread" | "ask" | "run" | "helper" | "console">;
  folderId?: string;
  recordId?: string;
  parentThreadId?: string;
  mine?: boolean;
  order?: "created" | "latest";
  exceptScope?: Array<string>;
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
        }>;
      createdAt: number;
      closedAt?: number;
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
    "exceptScope": [
      "task"
    ],
    "folderId": "fld_a1b2c3",
    "kind": [
      "chat"
    ],
    "limit": 1,
    "mine": true,
    "order": "created",
    "parentThreadId": "thr_a1b2c3",
    "recordId": "rec_a1b2c3"
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
            "mode": "lead",
            "model": "claude-sonnet-5-5",
            "provider": "anthropic",
            "watches": true
          }
        ],
        "channelId": "chn_a1b2c3",
        "closedAt": 1760000000000,
        "createdAt": 1760000000000,
        "folderId": "fld_a1b2c3",
        "following": true,
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
