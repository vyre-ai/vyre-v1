# runs.record_step

Write one row of the durable step log (state, input and output refs, error, trace span)

| | |
|---|---|
| Module | runs |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | run (/runId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/runs/record_step |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  runId: string;
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
  traceSpan?: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "attempt": 1,
    "branch": "example",
    "error": {
      "code": "example",
      "message": "example"
    },
    "inputRef": "example",
    "outputRef": "example",
    "runId": "run_a1b2c3",
    "state": "pending",
    "step": "example",
    "traceSpan": "example"
  },
  "output": {
    "ok": true
  }
}
```
