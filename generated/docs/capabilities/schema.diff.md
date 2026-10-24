# schema.diff

Preview a set of schema changes as a diff: what is added, what is destructive, rows affected, and a preview token

| | |
|---|---|
| Module | schema |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | schema.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/schema/diff |
| MCP tool | schema_diff (engineer) |
| CLI | vyre schema diff |
| Emits | none |

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
};
```

## Output

```ts
type Out = {
  previewToken: string;
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
  additive: number;
  destructive: number;
  problems: Array<{
      itemKey: string;
      message: string;
    }>;
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
    ]
  },
  "output": {
    "additive": 1,
    "destructive": 1,
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
    ],
    "previewToken": "example",
    "problems": [
      {
        "itemKey": "example",
        "message": "example"
      }
    ]
  }
}
```
