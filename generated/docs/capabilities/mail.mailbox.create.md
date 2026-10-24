# mail.mailbox.create

Create a shared, agent or service mailbox (hello@, support@, an agent address)

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mail/mailbox/create |
| MCP tool | mail_mailbox_create (inbox) |
| CLI | none |
| Emits | mailbox.created |

## Input

```ts
type In = {
  kind: "shared" | "agent" | "service";
  address: string;
  title: string;
  agentId?: string;
  provider?: "google" | "microsoft" | "imap" | "inbound_only";
  privacy?: "private" | "space" | "people";
  idempotencyKey: string;
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
- permission.role_lacks_permission
- validation.bad_input
- validation.duplicate

## Example

```json
{
  "name": "example",
  "input": {
    "address": "maya@example.com",
    "agentId": "agt_a1b2c3",
    "idempotencyKey": "idem_1",
    "kind": "shared",
    "privacy": "private",
    "provider": "google",
    "title": "example"
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
