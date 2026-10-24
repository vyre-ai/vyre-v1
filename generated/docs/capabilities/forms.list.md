# forms.list

List forms by section and folder

| | |
|---|---|
| Module | forms |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/forms/list |
| MCP tool | forms_list (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  section?: "personal" | "shared" | "space";
  folderId?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  forms: Array<{
      formId: string;
      name: string;
      recordType: string;
      kind: "public" | "one_use" | "booking" | "survey";
      state: "draft" | "published" | "closed";
      slug: string;
      submissions: number;
    }>;
  next?: string;
  total?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "cursor": "example",
    "folderId": "fld_a1b2c3",
    "limit": 1,
    "section": "personal"
  },
  "output": {
    "forms": [
      {
        "formId": "frm_a1b2c3",
        "kind": "public",
        "name": "example",
        "recordType": "contact",
        "slug": "intake",
        "state": "draft",
        "submissions": 1
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
