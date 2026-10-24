# google.dwd.setup

Store the service account JSON (Vault item Google_DWD), map members by email and, with auto-connect on, create their Pending mail and calendar connections

| | |
|---|---|
| Module | google |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/google/dwd/setup |
| MCP tool | google_dwd_setup (engineer) |
| CLI | none |
| Emits | google.dwd_configured |

## Input

```ts
type In = {
  vaultItem: string;
  adminEmail: string;
  domain?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  configured: boolean;
  scopes: Array<string>;
  mappedMembers: number;
  connected: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.auth_failed
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "adminEmail": "maya@example.com",
    "domain": "example",
    "idempotencyKey": "idem_1",
    "vaultItem": "#Dana_Lawmatics"
  },
  "output": {
    "configured": true,
    "connected": 1,
    "mappedMembers": 1,
    "scopes": [
      "example"
    ]
  }
}
```
