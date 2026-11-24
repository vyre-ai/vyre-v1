# sites.env_set

Set a site's env vars (replaces the list): a Vault key, or a plain value (not a secret). scope: production (default), previews, all

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | sites.deploy |
| Grant level | edit |
| Risk | medium |
| Resource | site (/siteId) |
| Gate | deploy when vault.key_host_unapproved(input) |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/sites/env_set |
| MCP tool | sites_env_set (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
  entries: Array<{
      name: string;
      vaultHandle?: string;
      value?: string;
      scope?: "all" | "production" | "previews";
      confirmPlain?: boolean;
    }>;
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "entries": [
      {
        "confirmPlain": true,
        "name": "example",
        "scope": "all",
        "value": "example",
        "vaultHandle": "#Dana_Lawmatics"
      }
    ],
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
