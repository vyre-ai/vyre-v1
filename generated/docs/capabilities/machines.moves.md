# machines.moves

Recent moves, Space-wide: each turn Automatic sent to another machine because the first in the order had no room, newest first. A member sees their own

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
| HTTP | POST /v1/machines/moves |
| MCP tool | machines_moves (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  limit?: number;
};
```

## Output

```ts
type Out = {
  moves: Array<{
      id: number;
      at: number;
      turnId: string | null;
      asker: string | null;
      agentId: string | null;
      threadId: string | null;
      from: string;
      to: string;
      why: string;
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
    "limit": 1
  },
  "output": {
    "moves": [
      {
        "agentId": "example",
        "asker": "example",
        "at": 1760000000000,
        "from": "example",
        "id": 1,
        "threadId": "example",
        "to": "example",
        "turnId": "example",
        "why": "example"
      }
    ]
  }
}
```
