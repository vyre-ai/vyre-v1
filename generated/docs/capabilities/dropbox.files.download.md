# dropbox.files.download

Download a Dropbox file, or one of its revisions, into a blob

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
| HTTP | POST /v1/dropbox/files/download |
| MCP tool | dropbox_files_download (files, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  path: string;
  rev?: string;
};
```

## Output

```ts
type Out = {
  blobId: string;
  size: number;
  mime: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.auth_failed
- validation.bad_input
- validation.not_found
- validation.too_large

## Example

```json
{
  "name": "example",
  "input": {
    "connectionId": "con_a1b2c3",
    "path": "example",
    "rev": "example"
  },
  "output": {
    "blobId": "blb_a1b2c3",
    "mime": "example",
    "size": 1
  }
}
```
