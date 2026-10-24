# scheduler.missed

Schedules missed in a period and what was done about each

| | |
|---|---|
| Module | scheduler-api |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/scheduler/missed |
| MCP tool | scheduler_missed (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  since: number;
};
```

## Output

```ts
type Out = {
  missed: Array<{
      scheduleId: string;
      owner: {
        kind: "automation" | "journey" | "agent_routine" | "campaign" | "gate" | "task" | "system";
        id: string;
      };
      scheduledFor: number;
      handling: "ran_once" | "skipped";
      runId?: string;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "since": 1760000000000
  },
  "output": {
    "missed": [
      {
        "handling": "ran_once",
        "owner": {
          "id": "aut_a1b2c3",
          "kind": "automation"
        },
        "runId": "run_a1b2c3",
        "scheduleId": "sch_a1b2c3",
        "scheduledFor": 1760000000000
      }
    ]
  }
}
```
