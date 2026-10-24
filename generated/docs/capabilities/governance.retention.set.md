# governance.retention.set

Set retention for one kind (for example 90d, 2y, forever), or for one record type when the kind is records

| | |
|---|---|
| Module | governance |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | policy.manage |
| Grant level | view |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/governance/retention/set |
| MCP tool | governance_retention_set (engineer) |
| CLI | none |
| Emits | policy.changed |

## Input

```ts
type In = {
  kind: "trash" | "run_logs" | "transcripts" | "audit" | "file_versions" | "logs" | "events" | "backups" | "memory" | "records";
  value: string;
  recordType?: string;
};
```

## Output

```ts
type Out = {
  row: {
    key: "trash" | "run_logs" | "transcripts" | "audit" | "file_versions" | "logs" | "events" | "backups" | "memory" | "records";
    title: string;
    default: string;
    value: string;
    overridden: boolean;
    holdable: boolean;
    tombstone: boolean;
    perRecordType?: Record<string, string>;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "kind": "trash",
    "recordType": "contact",
    "value": "90d"
  },
  "output": {
    "row": {
      "default": "30d",
      "holdable": true,
      "key": "trash",
      "overridden": true,
      "perRecordType": {},
      "title": "example",
      "tombstone": true,
      "value": "30d"
    }
  }
}
```
