# forms.link_create

Make a signed or one-use form link for one record that asks only for the missing fields (no emails in URLs)

| | |
|---|---|
| Module | forms |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | forms.publish |
| Grant level | edit |
| Risk | medium |
| Resource | form (/formId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/forms/link_create |
| MCP tool | forms_link_create (automations) |
| CLI | none |
| Emits | form.link_created |

## Input

```ts
type In = {
  formId: string;
  recordId: string;
  singleUse: boolean;
  expiresInHours?: number;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  url: string;
  expiresAt?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "expiresInHours": 1,
    "formId": "frm_a1b2c3",
    "idempotencyKey": "idem_1",
    "recordId": "rec_a1b2c3",
    "singleUse": true
  },
  "output": {
    "expiresAt": 1760000000000,
    "url": "example"
  }
}
```
