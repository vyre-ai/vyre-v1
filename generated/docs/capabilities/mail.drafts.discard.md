# mail.drafts.discard

Discard a draft

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
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mail/drafts/discard |
| MCP tool | mail_drafts_discard (inbox) |
| CLI | none |
| Emits | mail_draft.discarded |

## Input

```ts
type In = {
  draftId: string;
};
```

## Output

```ts
type Out = {
  discarded: boolean;
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
    "draftId": "eml_a1b2c3"
  },
  "output": {
    "discarded": true
  }
}
```
