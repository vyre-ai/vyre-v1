# governance.retention.get

Retention for every kind of data: default, value in force, overrides, whether holds and tombstones apply

| | |
|---|---|
| Module | governance |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | policy.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/governance/retention/get |
| MCP tool | governance_retention_get (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  kinds: Array<{
      key: "trash" | "run_logs" | "transcripts" | "audit" | "file_versions" | "logs" | "events" | "backups" | "memory" | "records";
      title: string;
      default: string;
      value: string;
      overridden: boolean;
      holdable: boolean;
      tombstone: boolean;
      perRecordType?: Record<string, string>;
    }>;
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
  "input": {},
  "output": {
    "kinds": [
      {
        "default": "30d",
        "holdable": true,
        "key": "trash",
        "overridden": true,
        "perRecordType": {},
        "title": "example",
        "tombstone": true,
        "value": "30d"
      }
    ]
  }
}
```
