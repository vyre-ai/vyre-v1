# governance.jobs.tick

System: the daily job for one kind; deletes or compacts what is past retention and skips what a hold covers

| | |
|---|---|
| Module | governance |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/governance/jobs/tick |
| MCP tool | none |
| CLI | none |
| Emits | retention.purged |

## Input

```ts
type In = {
  kind: "trash" | "run_logs" | "transcripts" | "audit" | "file_versions" | "logs" | "events" | "backups" | "memory" | "records";
};
```

## Output

```ts
type Out = {
  removed: number;
  skippedOnHold: number;
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
    "kind": "trash"
  },
  "output": {
    "removed": 1,
    "skippedOnHold": 1
  }
}
```
