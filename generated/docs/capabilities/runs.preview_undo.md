# runs.preview_undo

Show what Undo this run would reverse and what it cannot (sent messages and deployments)

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
| HTTP | POST /v1/runs/preview_undo |
| MCP tool | runs_preview_undo (automations) |
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
