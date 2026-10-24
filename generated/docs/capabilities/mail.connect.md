# mail.connect

Connect the caller's own mailbox: Gmail, Outlook or IMAP (member impersonation for Google and Graph, app password handle for IMAP)

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
| HTTP | POST /v1/mail/connect |
| MCP tool | mail_connect (inbox) |
| CLI | none |
| Emits | mailbox.connected |

## Input

```ts
type In = {
  provider: "google" | "microsoft" | "imap";
  address: string;
  privacy?: "private" | "space" | "people";
  imap?: {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    passwordHandle: string;
  };
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
- provider.auth_failed
- validation.bad_input
- validation.duplicate

## Example

```json
{
  "name": "example",
  "input": {
    "address": "maya@example.com",
    "idempotencyKey": "idem_1",
    "imap": {
      "host": "example",
      "passwordHandle": "#Dana_Lawmatics",
      "port": 1,
      "secure": true,
      "username": "example"
    },
    "privacy": "private",
    "provider": "google"
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
