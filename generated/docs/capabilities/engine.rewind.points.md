# engine.rewind.points

The points a person can go back to in a chat with an agent (one per turn that worked in a folder for them, newest first) and the rewinds in force: messages folded, who went back, the point that undoes it

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
  ownComputer: boolean;
  points: Array<{
      pointId: string;
      agentId: string;
      at: number;
      files: number;
      after?: string;
      messageId?: string;
      undo?: boolean;
      during?: boolean;
    }>;
  active: Array<{
      afterSeq: number;
      uptoSeq: number;
      by: string;
      at: number;
      undoPointId?: string;
      interrupted?: boolean;
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
    "active": [
      {
        "afterSeq": 1,
        "at": 1760000000000,
        "by": "example",
        "interrupted": true,
        "undoPointId": "example",
        "uptoSeq": 1
      }
    ],
    "available": true,
    "ownComputer": true,
    "points": [
      {
        "after": "example",
        "agentId": "agt_a1b2c3",
        "at": 1760000000000,
        "during": true,
        "files": 1,
        "messageId": "msg_a1b2c3",
        "pointId": "example",
        "undo": true
      }
    ],
    "why": "example"
  }
}
```
