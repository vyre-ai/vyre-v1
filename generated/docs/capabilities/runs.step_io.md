# runs.step_io

What one step of a Run was given and what it answered, as the step log holds them, with anything that looks like a key hidden

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
| HTTP | POST /v1/runs/step_io |
| MCP tool | runs_step_io (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  runId: string;
  step: string;
  attempt?: number;
};
```

## Output

```ts
type Out = {
  step: string;
  attempt: number;
  input?: unknown;
  output?: unknown;
  hidden: number;
  truncated: boolean;
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
    "runId": "run_a1b2c3",
    "step": "example"
  },
  "output": {
    "attempt": 1,
    "hidden": 1,
    "input": {},
    "output": {},
    "step": "example",
    "truncated": true
  }
}
```
