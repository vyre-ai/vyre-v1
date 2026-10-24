# journeys.preview_migrate

Preview a migration: records per old stage, where each goes, unmapped stages and blockers

| | |
|---|---|
| Module | journeys |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | journeys.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/journeys/preview_migrate |
| MCP tool | journeys_preview_migrate (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  journeyId: string;
  toVersion: number;
  stageMap?: Record<string, string>;
};
```

## Output

```ts
type Out = {
  fromVersion: number;
  toVersion: number;
  recordsAffected: number;
  moves: Array<{
      from: string;
      to: string | null;
      records: number;
    }>;
  unmapped: Array<string>;
  blockers: Array<string>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "journeyId": "jrn_a1b2c3",
    "stageMap": {},
    "toVersion": 1
  },
  "output": {
    "blockers": [
      "example"
    ],
    "fromVersion": 1,
    "moves": [
      {
        "from": "intake",
        "records": 1,
        "to": "intake"
      }
    ],
    "recordsAffected": 1,
    "toVersion": 1,
    "unmapped": [
      "intake"
    ]
  }
}
```
