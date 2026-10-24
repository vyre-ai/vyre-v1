# schema.infer

Propose a record type from pasted CSV text or a CSV/XLSX file: field names, types, choices and a title field

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
| HTTP | POST /v1/schema/infer |
| MCP tool | schema_infer (engineer) |
| CLI | vyre schema infer |
| Emits | none |

## Input

```ts
type In = {
  text?: string;
  fileId?: string;
  name?: string;
  sheet?: string;
};
```

## Output

```ts
type Out = {
  ops: Array<{
      op: "type.create" | "type.update" | "type.drop" | "field.add" | "field.update" | "field.retype" | "field.rename" | "field.drop" | "field.reorder" | "relation.add" | "relation.drop";
      type: string;
      field?: string;
      def?: Record<string, unknown>;
      newKey?: string;
      toType?: string;
      order?: Array<string>;
    }>;
  columns: Array<{
      column: string;
      field: string;
      type: string;
      sample: Array<string>;
    }>;
  rowCount: number;
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
    "fileId": "fil_a1b2c3",
    "name": "example",
    "sheet": "example",
    "text": "example"
  },
  "output": {
    "columns": [
      {
        "column": "example",
        "field": "phone",
        "sample": [
          "example"
        ],
        "type": "example"
      }
    ],
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
    "rowCount": 1
  }
}
```
