# schema.apply

Apply schema changes. Additions go straight through; destructive items (delete or retype a field, drop a type) must be listed in confirm

| | |
|---|---|
| Module | schema |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | schema.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/schema/apply |
| MCP tool | schema_apply (engineer) |
| CLI | vyre schema apply |
| Emits | schema.changed, schema.type_dropped |

## Input

```ts
type In = {
  ops: Array<{
      op: "type.create" | "type.update" | "type.drop" | "field.add" | "field.update" | "field.retype" | "field.rename" | "field.drop" | "field.reorder" | "relation.add" | "relation.drop";
      type: string;
      field?: string;
      def?: Record<string, unknown>;
      newKey?: string;
      toType?: string;
      order?: Array<string>;
    }>;
  previewToken?: string;
  confirm?: Array<string>;
  reason?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  changeId: string;
  applied: number;
  items: Array<{
      itemKey: string;
      op: string;
      type: string;
      field?: string;
      summary: string;
      destructive: boolean;
      affectedRows: number;
      copiedToTrash: boolean;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.on_hold
- permission.role_lacks_permission
- validation.bad_input
- validation.duplicate
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "confirm": [
      "example"
    ],
    "idempotencyKey": "idem_1",
    "ops": [
      {
        "def": {},
        "field": "phone",
        "newKey": "example",
        "op": "type.create",
        "order": [
          "phone"
        ],
        "toType": "example",
        "type": "contact"
      }
    ],
    "previewToken": "example",
    "reason": "example"
  },
  "output": {
    "applied": 1,
    "changeId": "sch_a1b2c3",
    "items": [
      {
        "affectedRows": 1,
        "copiedToTrash": true,
        "destructive": true,
        "field": "phone",
        "itemKey": "field.drop:contact.phone",
        "op": "example",
        "summary": "example",
        "type": "contact"
      }
    ]
  }
}
```
