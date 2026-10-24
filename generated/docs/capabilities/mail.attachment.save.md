# mail.attachment.save

Save an attachment into Files

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mail/attachment/save |
| MCP tool | mail_attachment_save (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  messageId: string;
  attachmentId: string;
  folderId?: string;
  idempotencyKey: string;
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
    "attachmentId": "example",
    "folderId": "fld_a1b2c3",
    "idempotencyKey": "idem_1",
    "messageId": "eml_a1b2c3"
  },
  "output": {
    "fileId": "fil_a1b2c3"
  }
}
```
