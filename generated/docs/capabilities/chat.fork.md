# chat.fork

Branch a chat at one message: a new private chat that holds a copy of everything up to there, with the same agents and a line that links back

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
| HTTP | POST /v1/chat/fork |
| MCP tool | chat_fork (chats) |
| CLI | vyre chat fork |
| Emits | thread.started, agent.engaged |

## Input

```ts
type In = {
  threadId: string;
  messageId?: string;
  title?: string;
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
    replyCount?: number;
    lastMessageAt?: number;
    path?: Array<{
        title: string;
        threadId: string;
      }>;
  };
  copied: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "messageId": "msg_a1b2c3",
    "threadId": "thr_a1b2c3",
    "title": "example"
  },
  "output": {
    "copied": 1,
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
      "lastMessageAt": 1760000000000,
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
      "replyCount": 1,
      "scopeId": "example",
      "scopeType": "record",
      "starter": "example",
      "threadId": "thr_a1b2c3",
      "title": "example"
    }
  }
}
```
