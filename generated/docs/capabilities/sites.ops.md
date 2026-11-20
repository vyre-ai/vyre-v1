# sites.ops

Site ops: logs, metrics, jobs, workers, backups; read the sites skill

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | sites.deploy |
| Grant level | edit |
| Risk | medium |
| Resource | site (/siteId) |
| Gate | deploy when sites.ops_gate(input) |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/sites/ops |
| MCP tool | sites_ops (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
  action: string;
  id?: string;
  args?: Record<string, unknown>;
};
```

## Output

```ts
type Out = {
  result: Record<string, unknown>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "action": "example",
    "args": {},
    "id": "example",
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "result": {}
  }
}
```
