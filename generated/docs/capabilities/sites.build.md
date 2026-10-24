# sites.build

Build the site from its repo (the site agent runs in the repo); test and verify

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | sites.deploy |
| Grant level | edit |
| Risk | medium |
| Resource | site (/siteId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/sites/build |
| MCP tool | sites_build (sites) |
| CLI | none |
| Emits | site.build_failed |

## Input

```ts
type In = {
  siteId: string;
  branch?: string;
};
```

## Output

```ts
type Out = {
  runId: string;
  deploymentId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "branch": "example",
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "deploymentId": "dpl_a1b2c3",
    "runId": "run_a1b2c3"
  }
}
```
