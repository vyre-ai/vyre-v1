# forms.fields_set

Set Ask, Show or Hide per field, prefill keys and multi-step grouping

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
| HTTP | POST /v1/forms/fields_set |
| MCP tool | forms_fields_set (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  formId: string;
  fields: Array<{
      field: string;
      mode: "ask" | "show" | "hide";
      prefillKey?: string;
      step?: number;
    }>;
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "fields": [
      {
        "field": "example",
        "mode": "ask",
        "prefillKey": "example",
        "step": 1
      }
    ],
    "formId": "frm_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
