# channels.create

Create a channel: public to the Team Space or invite-only, with any mix of people and agents

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | channels.create |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/channels/create |
| MCP tool | channels_create (chats) |
| CLI | vyre channels create |
| Emits | channel.created, thread.started, channel.agent_added, channel.member_added |

## Input

```ts
type In = {
  name: string;
  visibility: "public" | "invite";
  topic?: string;
  memberIds?: Array<string>;
  agentIds?: Array<string>;
  folderId?: string;
  recordId?: string;
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
    "agentIds": [
      "agt_a1b2c3"
    ],
    "folderId": "fld_a1b2c3",
    "idempotencyKey": "idem_1",
    "memberIds": [
      "usr_a1b2c3"
    ],
    "name": "intake",
    "recordId": "rec_a1b2c3",
    "topic": "example",
    "visibility": "public"
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
