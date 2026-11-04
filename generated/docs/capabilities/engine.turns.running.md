# engine.turns.running

Engine only: the turns running now with the machine each runs on (agent, asker, start, place; no message or title), for the Machines page

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
| Team Space only | no |
| HTTP | POST /v1/engine/turns/running |
| MCP tool | engine_turns_running (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  turns: Array<{
      turnId: string;
      agentId: string;
      asker: string;
      startedAt: number;
      where: {
        kind: "computer" | "server" | "space";
        name: string;
        nodeId?: string;
      };
    }>;
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
  "input": {},
  "output": {
    "turns": [
      {
        "agentId": "agt_a1b2c3",
        "asker": "example",
        "startedAt": 1760000000000,
        "turnId": "trn_a1b2c3",
        "where": {
          "kind": "computer",
          "name": "example",
          "nodeId": "example"
        }
      }
    ]
  }
}
```
