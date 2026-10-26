# bookings.page_create

Create a booking page with host or round-robin pool, length, buffer and questions

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
| Team Space only | yes |
| HTTP | POST /v1/bookings/page_create |
| MCP tool | bookings_page_create (automations) |
| CLI | none |
| Emits | form.created |

## Input

```ts
type In = {
  name: string;
  hostIds: Array<string>;
  lengthMinutes: number;
  bufferMinutes?: number;
  recordType: string;
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
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "bufferMinutes": 1,
    "hostIds": [
      "usr_a1b2c3"
    ],
    "idempotencyKey": "idem_1",
    "lengthMinutes": 5,
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
