# resend.inbound.get_email

Fetch an inbound email (body and attachments) by Resend id

| | |
|---|---|
| Module | resend |
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
| HTTP | POST /v1/resend/inbound/get_email |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  emailId: string;
};
```

## Output

```ts
type Out = {
  from: string;
  to: Array<string>;
  subject: string;
  text?: string;
  html?: string;
  messageId: string;
  receivedAt: number;
  attachments: Array<{
      name: string;
      mime: string;
      size: number;
      blobId: string;
    }>;
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
    "emailId": "example"
  },
  "output": {
    "attachments": [
      {
        "blobId": "blb_a1b2c3",
        "mime": "example",
        "name": "example",
        "size": 1
      }
    ],
    "from": "example",
    "html": "example",
    "messageId": "example",
    "receivedAt": 1760000000000,
    "subject": "example",
    "text": "example",
    "to": [
      "example"
    ]
  }
}
```
