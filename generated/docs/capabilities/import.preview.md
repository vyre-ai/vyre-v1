# import.preview

Preview an import: rows to create, update or skip, row errors, new fields, and a preview token

| | |
|---|---|
| Module | import |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | records.create |
| Grant level | view |
| Risk | low |
| Resource | record_type (/type) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/import/preview |
| MCP tool | import_preview (records) |
| CLI | vyre import preview |
| Emits | none |

## Input

```ts
type In = {
  importId: string;
  table?: string;
  type: string;
  mapping: Array<{
      column: string;
      field: string;
      transform?: string;
    }>;
  createFields?: boolean;
  match?: Array<string>;
  onMatch?: "update" | "skip" | "create";
  runAutomations?: boolean;
};
```

## Output

```ts
type Out = {
  previewToken: string;
  creates: number;
  updates: number;
  skips: number;
  errors: Array<{
      row: number;
      column?: string;
      message: string;
    }>;
  errorCount: number;
  newFields: Array<{
      key: string;
      type: string;
    }>;
  samples: Array<Record<string, unknown>>;
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
    "createFields": true,
    "importId": "imp_a1b2c3",
    "mapping": [
      {
        "column": "example",
        "field": "email",
        "transform": "example"
      }
    ],
    "match": [
      "email"
    ],
    "onMatch": "update",
    "runAutomations": true,
    "table": "example",
    "type": "contact"
  },
  "output": {
    "creates": 1,
    "errorCount": 1,
    "errors": [
      {
        "column": "example",
        "message": "example",
        "row": 1
      }
    ],
    "newFields": [
      {
        "key": "email",
        "type": "example"
      }
    ],
    "previewToken": "example",
    "samples": [
      {}
    ],
    "skips": 1,
    "updates": 1
  }
}
```
