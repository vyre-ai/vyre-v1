# threads.close

Close a thread (idle with nothing waiting, or done)

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/threads/close |
| MCP tool | threads_close (chats) |
| CLI | none |
| Emits | thread.closed |

## Input

```ts
type In = {
  threadId: string;
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
