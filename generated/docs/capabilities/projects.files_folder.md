# projects.files_folder

The folder that holds a record's files: a project's own, else Files > Projects > Record files > the record (made on first use unless create is false, with the record's access mirrored onto it)

| | |
|---|---|
| Module | projects |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | record (/recordId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/projects/files_folder |
| MCP tool | projects_files_folder (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type?: string;
  recordId: string;
  create?: boolean;
};
```

## Output

```ts
type Out = {
  folderId: string | null;
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
    "create": true,
    "recordId": "rec_a1b2c3",
    "type": "contact"
  },
  "output": {
    "folderId": "fld_a1b2c3"
  }
}
```
