# scheduler.report

System: the engine says how a claimed fire is going: running, waiting for a person, done, failed or stopped

| | |
|---|---|
| Module | scheduler-api |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/scheduler/report |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fireId: string;
  attempt: number;
  state: "running" | "waiting" | "done" | "failed" | "stopped" | "skipped";
  runId?: string;
  note?: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
  superseded?: boolean;
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
    "fireId": "example",
    "note": "example",
    "runId": "run_a1b2c3",
    "state": "running"
  },
  "output": {
    "ok": true,
    "superseded": true
  }
}
```
