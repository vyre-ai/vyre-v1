# engine.incidents.list

AI incidents for review

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
| HTTP | POST /v1/engine/incidents/list |
| MCP tool | engine_incidents_list (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  state?: Array<"open" | "assigned" | "resolved">;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  incidents: Array<{
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
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "limit": 1,
    "state": [
      "open"
    ]
  },
  "output": {
    "incidents": [
      {
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
    ],
    "next": "example",
    "total": 1
  }
}
```
