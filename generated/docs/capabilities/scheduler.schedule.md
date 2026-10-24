# scheduler.schedule

Schedule a capability call at a time or on a cron as a principal, with an if-missed rule

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
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/scheduler/schedule |
| MCP tool | none |
| CLI | none |
| Emits | schedule.created |

## Input

```ts
type In = {
  owner: {
    kind: "automation" | "journey" | "agent_routine" | "campaign" | "gate" | "task" | "system";
    id: string;
  };
  cap: string;
  input: unknown;
  when: {
    at: number;
  } | {
    cron: string;
    tz: string;
  };
  ifMissed?: "skip" | "run_once";
  principal?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  scheduleId: string;
  nextAt?: number;
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
    "cap": "automations.fire",
    "idempotencyKey": "idem_1",
    "ifMissed": "skip",
    "input": {},
    "owner": {
      "id": "aut_a1b2c3",
      "kind": "automation"
    },
    "principal": "example",
    "when": {
      "at": 1760000000000
    }
  },
  "output": {
    "nextAt": 1760000000000,
    "scheduleId": "sch_a1b2c3"
  }
}
```
