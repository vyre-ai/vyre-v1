# dropbox.files.list_revisions

List the saved revisions of a Dropbox file, newest first

| | |
|---|---|
| Module | dropbox |
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
| HTTP | POST /v1/dropbox/files/list_revisions |
| MCP tool | dropbox_files_list_revisions (files, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  path: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  revisions: Array<{
      id: string;
      name: string;
      path: string;
      pathLower: string;
      isFolder: boolean;
      deleted?: boolean;
      size?: number;
      rev?: string;
      modified?: string;
      contentHash?: string;
      webUrl: string;
    }>;
  deleted: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.auth_failed
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "connectionId": "con_a1b2c3",
    "limit": 1,
    "path": "example"
  },
  "output": {
    "deleted": true,
    "revisions": [
      {
        "contentHash": "example",
        "deleted": true,
        "id": "id:a4ayc_80_OEAAAAAAAAAXw",
        "isFolder": true,
        "modified": "example",
        "name": "example",
        "path": "example",
        "pathLower": "example",
        "rev": "example",
        "size": 1,
        "webUrl": "example"
      }
    ]
  }
}
```
