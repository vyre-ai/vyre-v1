# engine.now

Which agents are working right now: the agent, the person it works for, where it runs (the Space, their computer, their server) and since when; the chat is named only to someone who may read it

| | |
|---|---|
| Module | engine |
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
| HTTP | POST /v1/engine/now |
| MCP tool | engine_now (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  working: Array<{
      agentId: string;
      forPerson: string;
      where: "space" | "computer" | "server";
      since: number;
      threadId?: string;
      title?: string;
      channelId?: string;
      kind?: string;
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
    "working": [
      {
        "agentId": "agt_a1b2c3",
        "channelId": "chn_a1b2c3",
        "forPerson": "example",
        "kind": "example",
        "since": 1760000000000,
        "threadId": "thr_a1b2c3",
        "title": "example",
        "where": "space"
      }
    ]
  }
}
```
