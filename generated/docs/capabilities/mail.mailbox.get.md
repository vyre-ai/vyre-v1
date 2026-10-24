# mail.mailbox.get

Read one mailbox with its sync state

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | mailbox (/mailboxId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mail/mailbox/get |
| MCP tool | mail_mailbox_get (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  mailboxId: string;
};
```

## Output

```ts
type Out = {
  mailbox: {
    id: string;
    kind: "personal" | "shared" | "agent" | "service";
    address: string;
    title: string;
    ownerId?: string;
    agentId?: string;
    provider: "google" | "microsoft" | "imap" | "inbound_only";
    privacy: "private" | "space" | "people";
    state: "pending" | "syncing" | "paused" | "error" | "disconnected";
    lastSyncAt?: number;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "mailboxId": "mbx_a1b2c3"
  },
  "output": {
    "mailbox": {
      "address": "maya@example.com",
      "agentId": "agt_a1b2c3",
      "id": "mbx_a1b2c3",
      "kind": "personal",
      "lastSyncAt": 1760000000000,
      "ownerId": "usr_a1b2c3",
      "privacy": "private",
      "provider": "google",
      "state": "pending",
      "title": "example"
    }
  }
}
```
