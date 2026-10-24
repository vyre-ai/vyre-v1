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
      path?: Array<{
          title: string;
          threadId: string;
        }>;
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
        "kind": "chat",
        "listed": true,
        "members": [
          {
            "id": "usr_a1b2c3",
            "kind": "person"
          }
        ],
        "parentMessageId": "msg_a1b2c3",
        "parentThreadId": "thr_a1b2c3",
        "path": [
          {
            "threadId": "thr_a1b2c3",
            "title": "example"
          }
        ],
        "planMode": true,
        "recordId": "rec_a1b2c3",
        "scopeId": "example",
        "scopeType": "record",
        "starter": "example",
        "threadId": "thr_a1b2c3",
        "title": "example"
      }
    ],
    "total": 1
  }
}
```
