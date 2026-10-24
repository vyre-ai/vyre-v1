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
| Emits | thread.started, agent.engaged, message.received |

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
  }
}
```
