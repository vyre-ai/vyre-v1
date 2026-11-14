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
    kind: "automation" | "journey" | "agent_routine" | "gate" | "task" | "system" | "goal";
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
  kind?: "call" | "routine" | "watch" | "goal" | "baton";
  person?: string;
  agentId?: string;
  scope?: "private" | "shared" | "room";
  roomId?: string;
  zone?: string;
  quiet?: {
    from: string;
    to: string;
  };
  overlap?: "skip" | "coalesce";
  answerWithinMin?: number;
  maxAttempts?: number;
  nextAt?: number;
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
    "agentId": "agt_a1b2c3",
    "answerWithinMin": 1,
    "cap": "automations.fire",
    "idempotencyKey": "idem_1",
    "ifMissed": "skip",
    "input": {},
    "kind": "call",
    "maxAttempts": 1,
    "nextAt": 1760000000000,
    "overlap": "skip",
    "owner": {
      "id": "aut_a1b2c3",
      "kind": "automation"
    },
    "person": "usr_a1b2c3",
    "principal": "example",
    "quiet": {
      "from": "22:00",
      "to": "08:00"
    },
    "roomId": "chn_a1b2c3",
    "scope": "private",
    "when": {
      "at": 1760000000000
    },
    "zone": "Asia/Karachi"
  },
  "output": {
    "nextAt": 1760000000000,
    "scheduleId": "sch_a1b2c3"
  }
}
```
