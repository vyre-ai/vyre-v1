# dropbox.files.upload

Upload a Space file to Dropbox; with rev it only replaces that revision

| | |
|---|---|
| Module | dropbox |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | post |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/dropbox/files/upload |
| MCP tool | dropbox_files_upload (files, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  fileId: string;
  path: string;
  rev?: string;
};
```

## Output

```ts
type Out = {
  entry: {
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
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.auth_failed
- provider.network
- provider.unavailable
- validation.bad_input
- validation.too_large
- validation.version_conflict

## Example

```json
{
  "name": "example",
  "input": {
    "connectionId": "con_a1b2c3",
    "fileId": "fil_a1b2c3",
    "path": "example",
    "rev": "example"
  },
  "output": {
    "entry": {
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
  }
}
```
