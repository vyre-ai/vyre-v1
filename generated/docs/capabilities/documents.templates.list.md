# documents.templates.list

List files marked as templates the caller can open

| | |
|---|---|
| Module | documents |
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
| HTTP | POST /v1/documents/templates/list |
| MCP tool | documents_templates_list (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  folder?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  templates: Array<{
      fileId: string;
      name: string;
      folderId: string;
      fields: number;
      updatedAt: number;
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
    "folder": "fld_a1b2c3",
    "limit": 1
  },
  "output": {
    "next": "example",
    "templates": [
      {
        "fields": 1,
        "fileId": "fil_a1b2c3",
        "folderId": "fld_a1b2c3",
        "name": "example",
        "updatedAt": 1760000000000
      }
    ],
    "total": 1
  }
}
```
