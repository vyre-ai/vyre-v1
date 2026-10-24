# files.upload_url

Get a one-time address to upload bytes; the result is a blobId for files.create or files.write

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | files.write |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/files/upload_url |
| MCP tool | files_upload_url (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  size: number;
  mime?: string;
};
```

## Output

```ts
type Out = {
  blobId: string;
  url: string;
  expiresAt: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.too_large

## Example

```json
{
  "name": "example",
  "input": {
    "mime": "example",
    "size": 1
  },
  "output": {
    "blobId": "blb_a1b2c3",
    "expiresAt": 1760000000000,
    "url": "example"
  }
}
```
