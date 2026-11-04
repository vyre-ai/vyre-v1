# threads.agent_settings.set

Set how and when one agent answers in one chat: mode lead (answers everything), listen (when tagged) or quiet (listening, posts only when poked); when always, topics or hours; topics, hours and style (short or full). A tag or a poke still reaches an agent that is not quiet

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/threads/agent_settings/set |
| MCP tool | threads_agent_settings_set (chats) |
| CLI | none |
| Emits | thread.updated |

## Input

```ts
type In = {
  threadId: string;
  agentId: string;
  mode?: "lead" | "listen" | "quiet";
  when?: "always" | "topics" | "hours";
  topics?: string | null;
  hoursFrom?: string | null;
  hoursTo?: string | null;
  style?: "short" | "full";
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
    agentRepliesInThreads?: boolean;
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
    "agentId": "agt_a1b2c3",
    "hoursFrom": "09:00",
    "hoursTo": "09:00",
    "mode": "lead",
    "style": "short",
    "threadId": "thr_a1b2c3",
    "topics": "example",
    "when": "always"
  },
  "output": {
    "thread": {
      "agentRepliesInThreads": true,
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
  }
}
```
