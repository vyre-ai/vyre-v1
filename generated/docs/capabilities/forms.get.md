# forms.get

Read a form with its field modes, layout, theme and logic

| | |
|---|---|
| Module | forms |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | form (/formId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/forms/get |
| MCP tool | forms_get (automations) |
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
  form: {
    formId: string;
    name: string;
    recordType: string;
    kind: "public" | "one_use" | "booking" | "survey";
    state: "draft" | "published" | "closed";
    slug: string;
    submissions: number;
  };
  fields: Array<{
      field: string;
      mode: "ask" | "show" | "hide";
      prefillKey?: string;
    }>;
  theme?: Record<string, unknown>;
  logic?: unknown;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
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
    "fields": [
      {
        "field": "example",
        "mode": "ask",
        "prefillKey": "example"
      }
    ],
    "form": {
      "formId": "frm_a1b2c3",
      "kind": "public",
      "name": "example",
      "recordType": "contact",
      "slug": "intake",
      "state": "draft",
      "submissions": 1
    },
    "logic": {},
    "theme": {}
  }
}
```
