# engine.rewind.points

The points a person can go back to in a private chat with an agent: one per turn of an agent that worked in a folder on this computer for them, newest first, with when, how many files and what they had just asked. Not available in a chat with other people

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/rewind/points |
| MCP tool | engine_rewind_points (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
};
```

## Output

```ts
type Out = {
  available: boolean;
  why?: string;
  points: Array<{
      pointId: string;
      agentId: string;
      at: number;
      files: number;
      after?: string;
    }>;
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
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "available": true,
    "points": [
      {
        "after": "example",
        "agentId": "agt_a1b2c3",
        "at": 1760000000000,
        "files": 1,
        "pointId": "example"
      }
    ],
    "why": "example"
  }
}
```
