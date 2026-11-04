# chat.start

Start a chat or an Ask pane with one or more agents, or a direct message with one person (a third person means a channel)

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | chats.private |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chat/start |
| MCP tool | chat_start (chats) |
| CLI | vyre chat start |
| Emits | thread.started, agent.engaged, message.received, message.direct, thread.unarchived |

## Input

```ts
type In = {
  kind: "chat" | "ask";
  agentIds: Array<string>;
  personId?: string;
  title?: string;
  scopeType?: string;
  scopeId?: string;
  folderId?: string;
  recordId?: string;
  model?: string;
  provider?: string;
  effort?: "low" | "medium" | "high" | "max";
  first?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  thread: {
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
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "agentIds": [
      "agt_a1b2c3"
    ],
    "effort": "low",
    "first": "example",
    "folderId": "fld_a1b2c3",
    "idempotencyKey": "idem_1",
    "kind": "chat",
    "model": "example",
    "personId": "usr_a1b2c3",
    "provider": "example",
    "recordId": "rec_a1b2c3",
    "scopeId": "example",
    "scopeType": "example",
    "title": "example"
  },
  "output": {
    "thread": {
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
      "starter": "example",
      "threadId": "thr_a1b2c3",
      "title": "example",
      "unread": 1
    }
  }
}
```
