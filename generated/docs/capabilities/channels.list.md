# channels.list

List channels by section and folder (the items capability of the Channels list)

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/channels/list |
| MCP tool | channels_list (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  section?: "personal" | "shared" | "space";
  folderId?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  channels: Array<{
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
    }>;
  next?: string;
  total?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "cursor": "example",
    "folderId": "fld_a1b2c3",
    "limit": 1,
    "section": "personal"
  },
  "output": {
    "channels": [
      {
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
    ],
    "next": "example",
    "total": 1
  }
}
```
