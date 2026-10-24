# documents.fields

List the tags a template needs: text, date, money, list, conditions and loops

| | |
|---|---|
| Module | documents |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | file (/templateFileId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/documents/fields |
| MCP tool | documents_fields (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  templateFileId: string;
};
```

## Output

```ts
type Out = {
  fields: Array<{
      name: string;
      kind: "text" | "date" | "money" | "list" | "condition" | "loop";
      required: boolean;
      loop?: string;
    }>;
  loops: Array<string>;
  problems: Array<{
      message: string;
      tag?: string;
    }>;
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
    "templateFileId": "fil_a1b2c3"
  },
  "output": {
    "fields": [
      {
        "kind": "text",
        "loop": "example",
        "name": "grantor_name",
        "required": true
      }
    ],
    "loops": [
      "example"
    ],
    "problems": [
      {
        "message": "example",
        "tag": "example"
      }
    ]
  }
}
```
