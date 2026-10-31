# dropbox.files.list_folder

List a Dropbox folder, or continue a listing with its cursor; a cursor kept from before reads only what changed since

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
| HTTP | POST /v1/dropbox/files/list_folder |
| MCP tool | dropbox_files_list_folder (files, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  path?: string;
  recursive?: boolean;
  limit?: number;
  cursor?: string;
};
```

## Output

```ts
type Out = {
  entries: Array<{
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
  cursor: string;
  hasMore: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.auth_failed
- provider.rate_limited
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "connectionId": "con_a1b2c3",
    "cursor": "example",
    "limit": 1,
    "path": "example",
    "recursive": true
  },
  "output": {
    "cursor": "example",
    "entries": [
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
    ],
    "hasMore": true
  }
}
```
