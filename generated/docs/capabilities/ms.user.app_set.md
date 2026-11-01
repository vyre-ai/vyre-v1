# ms.user.app_set

Name the Vault item that holds the Microsoft OAuth app (client_id, client_secret when it has one, tenant when it is not common)

| | |
|---|---|
| Module | microsoft |
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
| HTTP | POST /v1/ms/user/app_set |
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
