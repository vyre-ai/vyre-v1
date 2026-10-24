# sites.previews

List previews (one per branch and pull request, on their own staging address)

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | site (/siteId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sites/previews |
| MCP tool | sites_previews (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
};
```

## Output

```ts
type Out = {
  previews: Array<{
      deploymentId: string;
      siteId: string;
      env: "staging" | "preview" | "production";
      state: "queued" | "building" | "ready" | "failed" | "stopped";
      url?: string;
      branch?: string;
      commit?: string;
      at: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "previews": [
      {
        "at": 1760000000000,
        "branch": "example",
        "commit": "example",
        "deploymentId": "dpl_a1b2c3",
        "env": "staging",
        "siteId": "sit_a1b2c3",
        "state": "queued",
        "url": "example"
      }
    ]
  }
}
```
