# runs.steps

The durable step log of a Run

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
| HTTP | POST /v1/runs/steps |
| MCP tool | runs_steps (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  runId: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  steps: Array<{
      step: string;
      attempt: number;
      state: "pending" | "running" | "succeeded" | "failed" | "skipped" | "waiting" | "stopped";
      branch?: string;
      inputRef?: string;
      outputRef?: string;
      error?: {
        code: string;
        message: string;
      };
      startedAt?: number;
      endedAt?: number;
      traceSpan?: string;
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
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "cursor": "example",
    "limit": 1,
    "runId": "run_a1b2c3"
  },
  "output": {
    "next": "example",
    "steps": [
      {
        "attempt": 1,
        "branch": "example",
        "endedAt": 1760000000000,
        "error": {
          "code": "example",
          "message": "example"
        },
        "inputRef": "example",
        "outputRef": "example",
        "startedAt": 1760000000000,
        "state": "pending",
        "step": "step_1",
        "traceSpan": "example"
      }
    ],
    "total": 1
  }
}
```
