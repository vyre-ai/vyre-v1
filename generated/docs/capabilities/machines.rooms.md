# machines.rooms

Room left on the machines you name (ids as machines.list gives them): the number placement skips a busy machine by, and the plain words for why ("4 of 4 turns"). Only machines you may see; used by engine.placement.decide

| | |
|---|---|
| Module | machines |
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
| HTTP | POST /v1/machines/rooms |
| MCP tool | machines_rooms (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  ids: Array<string>;
  agentId?: string;
};
```

## Output

```ts
type Out = {
  pinnedTo?: string;
  rooms: Array<{
      machineId: string;
      name: string;
      score: number;
      why: string;
      turns: number;
      maxTurns: number;
      draining: boolean;
      maxAgentComputers?: number;
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
  "input": {
    "agentId": "agt_a1b2c3",
    "ids": [
      "example"
    ]
  },
  "output": {
    "pinnedTo": "example",
    "rooms": [
      {
        "draining": true,
        "machineId": "example",
        "maxAgentComputers": 1,
        "maxTurns": 1,
        "name": "example",
        "score": 1,
        "turns": 1,
        "why": "example"
      }
    ]
  }
}
```
