# sites.logs

The log of a site: its running app, or with build the build log of a deployment (the latest when none is named). Text from the site, not Vyre content

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
  build?: boolean;
};
```

## Output

```ts
type Out = {
  lines: Array<string>;
  state?: "queued" | "building" | "ready" | "failed" | "stopped";
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
    "build": true,
    "deploymentId": "dpl_a1b2c3",
    "siteId": "sit_a1b2c3",
    "tail": 1
  },
  "output": {
    "lines": [
      "example"
    ],
    "state": "queued"
  }
}
```
