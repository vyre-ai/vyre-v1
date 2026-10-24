# sync_types.preview

Dry run: what a sync would do, such as will update 34 records in HubSpot, and the first-sync match counts

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | connectors.manage |
| Grant level | view |
| Risk | low |
| Resource | record_type (/type) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sync_types/preview |
| MCP tool | sync_types_preview (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
  direction?: "pull" | "push" | "both";
};
```

## Output

```ts
type Out = {
  creates: number;
  updates: number;
  removes: number;
  skips: number;
  summary: string;
  matches?: {
    sure: number;
    unsure: number;
    none: number;
  };
  samples: Array<{
      recordId?: string;
      remoteId?: string;
      op: string;
      changes: Record<string, unknown>;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "direction": "pull",
    "type": "contact"
  },
  "output": {
    "creates": 1,
    "matches": {
      "none": 1,
      "sure": 1,
      "unsure": 1
    },
    "removes": 1,
    "samples": [
      {
        "changes": {},
        "op": "example",
        "recordId": "rec_a1b2c3",
        "remoteId": "example"
      }
    ],
    "skips": 1,
    "summary": "Will update 34 records in HubSpot",
    "updates": 1
  }
}
```
