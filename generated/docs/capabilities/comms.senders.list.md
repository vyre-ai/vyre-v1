# comms.senders.list

Every address the caller can send from: mailboxes (Gmail, Outlook, IMAP, shared, agent, service), the Space sending domain (Resend or Mailgun) and texting numbers (Twilio). Senders the caller may not use are left out; ones that cannot send now come with usable false and why

| | |
|---|---|
| Module | inbox |
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
| HTTP | POST /v1/comms/senders/list |
| MCP tool | comms_senders_list (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  channel?: "email" | "text";
};
```

## Output

```ts
type Out = {
  senders: Array<{
      id: string;
      channel: "email" | "text";
      name: string;
      address: string;
      via: string;
      provider: string;
      scope: "mine" | "space";
      default: boolean;
      usable: boolean;
      why?: string;
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
    "channel": "email"
  },
  "output": {
    "senders": [
      {
        "address": "intake@example.com",
        "channel": "email",
        "default": true,
        "id": "mbx_a1b2c3",
        "name": "Intake line",
        "provider": "google",
        "scope": "mine",
        "usable": true,
        "via": "Gmail",
        "why": "example"
      }
    ]
  }
}
```
