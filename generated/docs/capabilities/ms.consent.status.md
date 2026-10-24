# ms.consent.status

State of the Microsoft 365 connection: app registered, consent given, access policy checked, mapped members

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
| HTTP | POST /v1/ms/consent/status |
| MCP tool | ms_consent_status (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  configured: boolean;
  tenantId?: string;
  consentGiven: boolean;
  policyConfirmed: boolean;
  lastVerifyAt?: number;
  autoConnect: boolean;
  mappedMembers: number;
  excluded: Array<string>;
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
  "input": {},
  "output": {
    "autoConnect": true,
    "configured": true,
    "consentGiven": true,
    "excluded": [
      "maya@example.com"
    ],
    "lastVerifyAt": 1760000000000,
    "mappedMembers": 1,
    "policyConfirmed": true,
    "tenantId": "example"
  }
}
```
