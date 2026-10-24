# scheduler.reschedule

Change the time, cron or if-missed rule of a schedule

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
| HTTP | POST /v1/scheduler/reschedule |
| MCP tool | scheduler_reschedule (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  scheduleId: string;
  when?: {
    at: number;
  } | {
    cron: string;
    tz: string;
  };
  ifMissed?: "skip" | "run_once";
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
    "ifMissed": "skip",
    "scheduleId": "sch_a1b2c3",
    "when": {
      "at": 1760000000000
    }
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
