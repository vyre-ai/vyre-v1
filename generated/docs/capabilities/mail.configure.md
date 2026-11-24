# mail.configure

Email setup, templates and inbox health: action status|test|smtp_*|address_*|monitor|template_*|doc_template_*

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mail/configure |
| MCP tool | mail_configure (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  action: "status" | "test" | "smtp_get" | "smtp_set" | "smtp_verify" | "address_list" | "address_add" | "address_move" | "monitor" | "template_list" | "template_get" | "template_preview" | "template_save" | "template_reset" | "doc_template_get" | "doc_template_set" | "doc_template_clear";
  key?: string;
  documentId?: string;
  subject?: string;
  text?: string;
  recordType?: string;
  recordId?: string;
  vars?: Record<string, unknown>;
  to?: string;
  host?: string;
  port?: number;
  security?: "starttls" | "tls";
  username?: string;
  passwordHandle?: string;
  domainId?: string;
  localPart?: string;
  mailboxId?: string;
  fromMailboxId?: string;
  title?: string;
  nonce?: string;
};
```

## Output

```ts
type Out = {
  result: unknown;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.network
- provider.unavailable
- validation.bad_input
- validation.duplicate
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "action": "status",
    "documentId": "fil_a1b2c3",
    "domainId": "dom_a1b2c3",
    "fromMailboxId": "mbx_a1b2c3",
    "host": "example",
    "key": "signature.request",
    "localPart": "example",
    "mailboxId": "mbx_a1b2c3",
    "nonce": "example",
    "passwordHandle": "#Dana_Lawmatics",
    "port": 1,
    "recordId": "rec_a1b2c3",
    "recordType": "contact",
    "security": "starttls",
    "subject": "example",
    "text": "example",
    "title": "example",
    "to": "maya@example.com",
    "username": "example",
    "vars": {}
  },
  "output": {
    "result": {}
  }
}
```
