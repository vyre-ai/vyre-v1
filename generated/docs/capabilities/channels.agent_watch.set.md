# channels.agent_watch.set

Let an agent act unmentioned in a channel ("watches this channel"); every such act is logged like a routine

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | channels.agents |
| Grant level | manage |
| Risk | medium |
| Resource | channel (/channelId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/channels/agent_watch/set |
| MCP tool | channels_agent_watch_set (chats) |
| CLI | none |
| Emits | channel.agent_watch_changed |

## Input

```ts
type In = {
  channelId: string;
  agentId: string;
  watches: boolean;
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
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "channelId": "chn_a1b2c3",
    "watches": true
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
