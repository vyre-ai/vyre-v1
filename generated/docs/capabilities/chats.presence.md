# chats.presence

Who is around (online or away; offline people are left out) and which agents are working now, with the chat when the asker may read it: the sidebar's dots and rings

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
| Team Space only | yes |
| HTTP | POST /v1/chats/presence |
| MCP tool | chats_presence (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  people: Array<{
      personId: string;
      state: "online" | "away";
    }>;
  working: Array<{
      agentId: string;
      threadId?: string;
      since: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "people": [
      {
        "personId": "usr_a1b2c3",
        "state": "online"
      }
    ],
    "working": [
      {
        "agentId": "agt_a1b2c3",
        "since": 1760000000000,
        "threadId": "thr_a1b2c3"
      }
    ]
  }
}
```
