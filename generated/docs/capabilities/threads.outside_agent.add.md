# threads.outside_agent.add

Bring an outside agent into this chat with exactly this chat, its project, files folder and record, each tagged with the chat; it shows as "<person> (Agent)" and removing it ends access at once. You can only give what you hold

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | channels.agents |
| Grant level | use |
| Risk | medium |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/threads/outside_agent/add |
| MCP tool | threads_outside_agent_add (chats) |
| CLI | none |
| Emits | agent.engaged |

## Input

```ts
type In = {
  threadId: string;
  agentId: string;
  mode?: "lead" | "listen" | "quiet";
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
  granted: Array<{
      type: string;
      id: string;
      level: string;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.not_contained
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "mode": "lead",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "granted": [
      {
        "id": "example",
        "level": "example",
        "type": "example"
      }
    ],
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
