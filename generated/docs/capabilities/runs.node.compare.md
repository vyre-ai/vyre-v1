# runs.node.compare

A finished node and everything started again from it, side by side: brief, result, cost and time of each (only for the owner or a manager of runs; someone who may only view the run is refused)

| | |
|---|---|
| Module | runs |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | run (/runId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/runs/node/compare |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  runId: string;
};
```

## Output

```ts
type Out = {
  sides: Array<{
      runId?: string;
      threadId?: string;
      status: string;
      brief?: {
        goal?: string;
        instructions?: string;
      };
      result?: string;
      usdMicros: number;
      tokens: number;
      seconds?: number;
      model?: string;
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
    "runId": "run_a1b2c3"
  },
  "output": {
    "sides": [
      {
        "brief": {
          "goal": "example",
          "instructions": "example"
        },
        "model": "example",
        "result": "example",
        "runId": "run_a1b2c3",
        "seconds": 1,
        "status": "example",
        "threadId": "thr_a1b2c3",
        "tokens": 1,
        "usdMicros": 1
      }
    ]
  }
}
```
