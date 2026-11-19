# automations.why_not

Why Automations did not run for a record, and what stopped each

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | record (/recordId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/automations/why_not |
| MCP tool | automations_why_not (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
  recordId: string;
  eventId?: string;
};
```

## Output

```ts
type Out = {
  record: {
    id: string;
    type?: string;
    typeName?: string;
    title?: string;
  };
  changes: Array<{
      eventId: string;
      at: number;
      line: string;
      by?: string;
    }>;
  eventId?: string;
  automations: Array<{
      automationId: string;
      name: string;
      status: "on" | "off" | "draft" | "paused";
      verdict: "not_started" | "stopped" | "failed" | "waiting" | "running" | "ran" | "off";
      line: string;
      checks: Array<{
          ok: boolean;
          line: string;
          detail?: string;
        }>;
      runId?: string;
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
    "eventId": "evt_a1b2c3",
    "recordId": "rec_a1b2c3",
    "type": "contact"
  },
  "output": {
    "automations": [
      {
        "automationId": "aut_a1b2c3",
        "checks": [
          {
            "detail": "example",
            "line": "example",
            "ok": true
          }
        ],
        "line": "example",
        "name": "example",
        "runId": "run_a1b2c3",
        "status": "on",
        "verdict": "not_started"
      }
    ],
    "changes": [
      {
        "at": 1760000000000,
        "by": "example",
        "eventId": "evt_a1b2c3",
        "line": "example"
      }
    ],
    "eventId": "evt_a1b2c3",
    "record": {
      "id": "rec_a1b2c3",
      "title": "example",
      "type": "contact",
      "typeName": "example"
    }
  }
}
```
