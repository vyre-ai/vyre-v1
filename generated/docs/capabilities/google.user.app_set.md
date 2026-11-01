# google.user.app_set

Name the Vault item that holds the Google OAuth client (client_id, and client_secret for a web client)

| | |
|---|---|
| Module | google |
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
| HTTP | POST /v1/google/user/app_set |
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
  clientId: string;
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
    "clientId": "example",
    "configured": true
  }
}
```
