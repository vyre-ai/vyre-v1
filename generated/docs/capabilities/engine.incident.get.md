# engine.incident.get

Read one AI incident with its notes

| | |
|---|---|
| Module | engine |
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
| HTTP | POST /v1/engine/incident/get |
| MCP tool | engine_incident_get (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  incidentId: string;
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
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "incidentId": "inc_a1b2c3"
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
