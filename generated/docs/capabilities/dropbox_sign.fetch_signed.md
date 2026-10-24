# dropbox_sign.fetch_signed

Download the signed PDF and audit certificate from Dropbox Sign

| | |
|---|---|
| Module | dropbox-sign |
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
| HTTP | POST /v1/dropbox_sign/fetch_signed |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  remoteId: string;
};
```

## Output

```ts
type Out = {
  fileId: string;
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
    "remoteId": "example"
  },
  "output": {
    "fileId": "fil_a1b2c3"
  }
}
```
