# dropbox.app.set

Name the Vault item that holds the Dropbox app key (and secret, for change notices)

| | |
|---|---|
| Module | dropbox |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/dropbox/app/set |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  vaultItem: string;
};
```

## Output

```ts
type Out = {
  configured: boolean;
  appKey: string;
  webhooks: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.auth_failed
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "vaultItem": "#Dana_Lawmatics"
  },
  "output": {
    "appKey": "example",
    "configured": true,
    "webhooks": true
  }
}
```
