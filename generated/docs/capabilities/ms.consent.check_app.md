# ms.consent.check_app

Prove the app registration in the Vault signs in to its tenant, with no person involved. Answers what is wrong in plain words; never the secret

| | |
|---|---|
| Module | microsoft |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | connectors.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/ms/consent/check_app |
| MCP tool | ms_consent_check_app (engineer) |
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
  ok: boolean;
  clientId?: string;
  tenantId?: string;
  credential?: "certificate" | "secret";
  problem?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
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
    "credential": "certificate",
    "ok": true,
    "problem": "example",
    "tenantId": "example"
  }
}
```
