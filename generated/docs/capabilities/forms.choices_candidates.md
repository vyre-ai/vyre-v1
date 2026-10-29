# forms.choices_candidates

The records the publisher can see, or the people in the Space, that a relation or person question could offer; display labels only

| | |
|---|---|
| Module | forms |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | forms.publish |
| Grant level | view |
| Risk | low |
| Resource | form (/formId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/forms/choices_candidates |
| MCP tool | forms_choices_candidates (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  formId: string;
  field: string;
  q?: string;
};
```

## Output

```ts
type Out = {
  candidates: Array<{
      refId: string;
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

## Example

```json
{
  "name": "example",
  "input": {
    "field": "example",
    "formId": "frm_a1b2c3",
    "q": "example"
  },
  "output": {
    "candidates": [
      {
        "label": "example",
        "refId": "example"
      }
    ]
  }
}
```
