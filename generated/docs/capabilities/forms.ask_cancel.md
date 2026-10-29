# forms.ask_cancel

Stop my Ask Vyre request on a form that is still waiting for the agent

| | |
|---|---|
| Module | forms |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | forms.publish |
| Grant level | edit |
| Risk | low |
| Resource | form (/formId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/forms/ask_cancel |
| MCP tool | forms_ask_cancel (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  formId: string;
};
```

## Output

```ts
type Out = {
  cancelled: number;
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
    "formId": "frm_a1b2c3"
  },
  "output": {
    "cancelled": 1
  }
}
```
