# threads.make_channel

Make a private chat into a channel with another person; the new channel links back to the chat

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | channels.create |
| Grant level | edit |
| Risk | medium |
| Resource | thread (create under /threadId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/threads/make_channel |
| MCP tool | threads_make_channel (chats) |
| CLI | none |
| Emits | channel.created, thread.promoted, channel.agent_added, channel.member_added |

## Input

```ts
type In = {
  threadId: string;
  personId: string;
  name?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  channel: {
    channelId: string;
    mainThreadId: string;
    name: string;
    topic?: string;
    visibility: "public" | "invite";
    folderId?: string;
    recordId?: string;
    archived: boolean;
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
    unread: number;
    createdAt: number;
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
    "idempotencyKey": "idem_1",
    "name": "example",
    "personId": "usr_a1b2c3",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "channel": {
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
      "archived": true,
      "channelId": "chn_a1b2c3",
      "createdAt": 1760000000000,
      "folderId": "fld_a1b2c3",
      "mainThreadId": "thr_a1b2c3",
      "members": [
        {
          "id": "usr_a1b2c3",
          "kind": "person"
        }
      ],
      "name": "intake",
      "recordId": "rec_a1b2c3",
      "topic": "example",
      "unread": 1,
      "visibility": "public"
    }
  }
}
```
