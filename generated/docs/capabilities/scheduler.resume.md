# scheduler.resume

Resume a paused schedule

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
| HTTP | POST /v1/scheduler/resume |
| MCP tool | scheduler_resume (automations) |
| CLI | none |
| Emits | schedule.resumed |

## Input

```ts
type In = {
  scheduleId: string;
};
```

## Output

```ts
type Out = {
  schedule: {
    id: string;
    owner: {
      kind: "automation" | "journey" | "agent_routine" | "campaign" | "gate" | "task" | "system";
      id: string;
    };
    principal: string;
    cap: string;
    when: {
      at: number;
    } | {
      cron: string;
      tz: string;
    };
    ifMissed: "skip" | "run_once";
    active: boolean;
    pausedReason?: string;
    nextAt?: number;
    lastFiredAt?: number;
    createdAt: number;
  };
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
    "scheduleId": "sch_a1b2c3"
  },
  "output": {
    "schedule": {
      "active": true,
      "cap": "automations.fire",
      "createdAt": 1760000000000,
      "id": "sch_a1b2c3",
      "ifMissed": "skip",
      "lastFiredAt": 1760000000000,
      "nextAt": 1760000000000,
      "owner": {
        "id": "aut_a1b2c3",
        "kind": "automation"
      },
      "pausedReason": "example",
      "principal": "example",
      "when": {
        "at": 1760000000000
      }
    }
  }
}
```
