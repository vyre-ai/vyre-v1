# automations.schedule_choose

Apply one recovery choice to a schedule whose backlog is over its cap

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | automation (/automationId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/automations/schedule_choose |
| MCP tool | automations_schedule_choose (automations) |
| CLI | none |
| Emits | automation.enabled, automation.disabled, automation.updated, automation.run_started, automation.trigger_dropped |

## Input

```ts
type In = {
  automationId: string;
  choice: "run_first_n" | "run_latest_n" | "skip_backlog_and_resume" | "change_limits" | "keep_paused";
  n?: number;
  limits?: {
    lookbackMs?: number;
    cap?: number;
    spacingMs?: number;
    overlap?: "queue" | "skip_while_active" | "bounded_concurrency";
    concurrency?: number;
  };
};
```

## Output

```ts
type Out = {
  ok: boolean;
  started: Array<{
      automationId: string;
      tickId: string;
      runId: string;
    }>;
  paused: boolean;
  error?: string;
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
    "automationId": "aut_a1b2c3",
    "choice": "run_first_n",
    "limits": {
      "cap": 1,
      "concurrency": 1,
      "lookbackMs": 1,
      "overlap": "queue",
      "spacingMs": 1
    },
    "n": 1
  },
  "output": {
    "error": "example",
    "ok": true,
    "paused": true,
    "started": [
      {
        "automationId": "aut_a1b2c3",
        "runId": "run_a1b2c3",
        "tickId": "example"
      }
    ]
  }
}
```
