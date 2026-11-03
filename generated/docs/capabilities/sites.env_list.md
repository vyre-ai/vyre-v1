# sites.env_list

List env var names and the Vault keys they come from (never values), and the names the app looks for that are not set yet

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
| HTTP | POST /v1/sites/env_list |
| MCP tool | sites_env_list (sites) |
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
  entries: Array<{
      name: string;
      vaultName: string;
      injected: boolean;
    }>;
  wanted?: Array<string>;
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
    "entries": [
      {
        "injected": true,
        "name": "example",
        "vaultName": "example"
      }
    ],
    "wanted": [
      "example"
    ]
  }
}
```
