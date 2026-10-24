# mailgun.send_email

Send one email through Mailgun (the send.email backend behind mail.send)

| | |
|---|---|
| Module | mailgun |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | send |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mailgun/send_email |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  domain: string;
  from: string;
  fromName?: string;
  to: Array<string>;
  cc?: Array<string>;
  bcc?: Array<string>;
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{
      name: string;
      fileId: string;
    }>;
  headers?: Record<string, string>;
  tags?: Array<string>;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  providerId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.auth_failed
- provider.bad_response
- provider.network
- provider.rate_limited
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "attachments": [
      {
        "fileId": "fil_a1b2c3",
        "name": "example"
      }
    ],
    "bcc": [
      "maya@example.com"
    ],
    "cc": [
      "maya@example.com"
    ],
    "domain": "example",
    "from": "maya@example.com",
    "fromName": "example",
    "headers": {},
    "html": "example",
    "idempotencyKey": "idem_1",
    "replyTo": "maya@example.com",
    "subject": "example",
    "tags": [
      "example"
    ],
    "text": "example",
    "to": [
      "maya@example.com"
    ]
  },
  "output": {
    "providerId": "example"
  }
}
```
