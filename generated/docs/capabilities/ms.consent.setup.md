# ms.consent.setup

Store the app registration (Vault item Microsoft_App), map members by email and, with auto-connect on, create their Pending mail and calendar connections

| | |
|---|---|
| Module | microsoft |
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
| HTTP | POST /v1/ms/consent/setup |
| MCP tool | ms_consent_setup (engineer) |
| CLI | none |
| Emits | microsoft.consent_configured |

## Input

```ts
type In = {
  vaultItem: string;
  tenantId: string;
  domain?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  configured: boolean;
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
    "domain": "example",
    "idempotencyKey": "idem_1",
    "tenantId": "example",
    "vaultItem": "#Dana_Lawmatics"
  },
  "output": {
    "configured": true,
    "connected": 1,
    "mappedMembers": 1
  }
}
```
