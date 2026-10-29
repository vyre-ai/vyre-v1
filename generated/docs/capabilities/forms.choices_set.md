# forms.choices_set

Publish the records or people a public relation or person question may offer: a bounded list the visitor can only pick from; a visitor sees each one's display label only

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
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/forms/choices_set |
| MCP tool | forms_choices_set (automations) |
| CLI | none |
| Emits | form.choices_changed |

## Input

```ts
type In = {
  formId: string;
  field: string;
  choices: Array<{
      refId: string;
    }>;
};
```

## Output

```ts
type Out = {
  choices: Array<{
      key: string;
      refId: string;
      kind: "record" | "person";
      label: string;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found
- validation.precondition_failed
- validation.too_large

## Example

```json
{
  "name": "example",
  "input": {
    "choices": [
      {
        "refId": "example"
      }
    ],
    "field": "example",
    "formId": "frm_a1b2c3"
  },
  "output": {
    "choices": [
      {
        "key": "example",
        "kind": "record",
        "label": "example",
        "refId": "example"
      }
    ]
  }
}
```
