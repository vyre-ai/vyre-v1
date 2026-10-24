# sites.logs

Container logs of a deployment (ids and text from the site, not Vyre content)

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | sites.deploy |
| Grant level | view |
| Risk | low |
| Resource | site (/siteId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sites/logs |
| MCP tool | sites_logs (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
  deploymentId?: string;
  tail?: number;
};
```

## Output

```ts
type Out = {
  lines: Array<string>;
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
    "deploymentId": "dpl_a1b2c3",
    "siteId": "sit_a1b2c3",
    "tail": 1
  },
  "output": {
    "lines": [
      "example"
    ]
  }
}
```
