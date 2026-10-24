# runs.undo

Undo this run: replay the inverse of its writes for events still at the Run version and report the rest

| | |
|---|---|
| Module | runs |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | high |
| Resource | run (/runId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/runs/undo |
| MCP tool | runs_undo (automations) |
| CLI | none |
| Emits | run.undone |

## Input

```ts
type In = {
  runId: string;
  reason?: string;
};
```

## Output

```ts
type Out = {
  undone: Array<{
      eventId: string;
      summary: string;
    }>;
  skipped: Array<{
      eventId: string;
      summary: string;
      reason: "changed_since" | "not_undoable" | "sent" | "deployed";
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.on_hold
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "reason": "example",
    "runId": "run_a1b2c3"
  },
  "output": {
    "skipped": [
      {
        "eventId": "evt_a1b2c3",
        "reason": "changed_since",
        "summary": "example"
      }
    ],
    "undone": [
      {
        "eventId": "evt_a1b2c3",
        "summary": "example"
      }
    ]
  }
}
```
