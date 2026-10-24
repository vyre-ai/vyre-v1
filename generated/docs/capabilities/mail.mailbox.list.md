# mail.mailbox.list

List mailboxes the caller can see (own, shared with the Space, agent and service mailboxes)

| | |
|---|---|
| Module | mail |
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
| HTTP | POST /v1/mail/mailbox/list |
| MCP tool | mail_mailbox_list (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  scope?: "mine" | "shared" | "all";
  kind?: "personal" | "shared" | "agent" | "service";
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  mailboxes: Array<{
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
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "kind": "personal",
    "limit": 1,
    "scope": "mine"
  },
  "output": {
    "mailboxes": [
      {
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
    ],
    "next": "example",
    "total": 1
  }
}
```
