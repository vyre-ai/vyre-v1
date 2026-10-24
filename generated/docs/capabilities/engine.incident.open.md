# engine.incident.open

Open an AI incident (people report one; the system opens them for label denials, scrub misses and runaway spend)

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/incident/open |
| MCP tool | engine_incident_open (meta) |
| CLI | none |
| Emits | incident.opened |

## Input

```ts
type In = {
  kind: "label_denied" | "scrub_miss" | "runaway_spend" | "repeated_failure" | "person_report" | "other";
  title: string;
  agentId?: string;
  turnId?: string;
  note?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  incident: {
    incidentId: string;
    kind: "label_denied" | "scrub_miss" | "runaway_spend" | "repeated_failure" | "person_report" | "other";
    title: string;
    state: "open" | "assigned" | "resolved";
    ownerId?: string;
    agentId?: string;
    turnId?: string;
    openedAt: number;
    resolvedAt?: number;
    notes: Array<{
        by: string;
        at: number;
        text: string;
      }>;
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
    "agentId": "agt_a1b2c3",
    "idempotencyKey": "idem_1",
    "kind": "label_denied",
    "note": "example",
    "title": "example",
    "turnId": "trn_a1b2c3"
  },
  "output": {
    "incident": {
      "agentId": "agt_a1b2c3",
      "incidentId": "inc_a1b2c3",
      "kind": "label_denied",
      "notes": [
        {
          "at": 1760000000000,
          "by": "example",
          "text": "example"
        }
      ],
      "openedAt": 1760000000000,
      "ownerId": "usr_a1b2c3",
      "resolvedAt": 1760000000000,
      "state": "open",
      "title": "example",
      "turnId": "trn_a1b2c3"
    }
  }
}
```
