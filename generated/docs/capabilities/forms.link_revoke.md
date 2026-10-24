# forms.link_revoke

Revoke a one-use link

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
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/forms/link_revoke |
| MCP tool | forms_link_revoke (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  formId: string;
  token: string;
};
```

## Output

```ts
type Out = {
  revoked: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "formId": "frm_a1b2c3",
    "token": "example"
  },
  "output": {
    "revoked": true
  }
}
```
