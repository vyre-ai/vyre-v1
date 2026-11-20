# sites.job_delete

Delete a scheduled job and its history; a run that is going is stopped

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | sites.deploy |
| Grant level | edit |
| Risk | medium |
| Resource | site (/siteId) |
| Gate | delete when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sites/job_delete |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
  jobId: string;
};
```

## Output

```ts
type Out = {
  removed: boolean;
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
    "jobId": "job_a1b2c3",
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "removed": true
  }
}
```
