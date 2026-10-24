# channels.get

Read one channel with members, agents and unread count

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | channel (/channelId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/channels/get |
| MCP tool | channels_get (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  channelId: string;
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
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "channelId": "chn_a1b2c3"
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
