# forms.create

Create a form on a record type; every input maps to a field

| | |
|---|---|
| Module | forms |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | forms.publish |
| Grant level | edit |
| Risk | medium |
| Resource | form (create under /recordType) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/forms/create |
| MCP tool | forms_create (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  name: string;
  recordType: string;
  kind: "public" | "one_use" | "booking" | "survey";
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  form: {
    formId: string;
    name: string;
    recordType: string;
    kind: "public" | "one_use" | "booking" | "survey";
    state: "draft" | "published" | "closed";
    slug: string;
    submissions: number;
  };
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
    "idempotencyKey": "idem_1",
    "kind": "public",
    "name": "example",
    "recordType": "contact"
  },
  "output": {
    "form": {
      "formId": "frm_a1b2c3",
      "kind": "public",
      "name": "example",
      "recordType": "contact",
      "slug": "intake",
      "state": "draft",
      "submissions": 1
    }
  }
}
```
