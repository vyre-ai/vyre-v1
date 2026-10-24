# files.resolve

Turn a tree path such as Projects/Probate GTM/plan.md into an id

| | |
|---|---|
| Module | files |
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
| HTTP | POST /v1/files/resolve |
| MCP tool | files_resolve (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  path: string;
};
```

## Output

```ts
type Out = {
  kind: "file" | "folder";
  fileId?: string;
  folderId?: string;
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
    "path": "example"
  },
  "output": {
    "fileId": "fil_a1b2c3",
    "folderId": "fld_a1b2c3",
    "kind": "file"
  }
}
```
