# ms.consent.verify

Call GET /organization and check consent and the access policy for a probe member

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
| HTTP | POST /v1/ms/consent/verify |
| MCP tool | ms_consent_verify (engineer) |
| CLI | none |
| Emits | microsoft.consent_verified |

## Input

```ts
type In = {
  as?: string;
  policyConfirmed?: boolean;
};
```

## Output

```ts
type Out = {
  ok: boolean;
  missingPermissions: Array<string>;
  detail?: string;
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
    "as": "maya@example.com",
    "policyConfirmed": true
  },
  "output": {
    "detail": "example",
    "missingPermissions": [
      "example"
    ],
    "ok": true
  }
}
```
