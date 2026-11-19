# mail.inbox.monitor

Each inbox you may see: how it is fed, when it last received, whether it is working, what failed and the one thing to do; and mail that arrived for an address no inbox answers to

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
| HTTP | POST /v1/mail/inbox/monitor |
| MCP tool | mail_inbox_monitor (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  mailboxId?: string;
};
```

## Output

```ts
type Out = {
  inboxes: Array<{
      mailboxId: string;
      address: string;
      kind: "personal" | "shared" | "agent" | "service";
      how: "imap" | "google" | "microsoft" | "provider_webhook";
      state: "ok" | "late" | "failing" | "paused";
      lastReceivedAt?: number;
      lastSyncAt?: number;
      receivedToday: number;
      problem?: {
        reason: string;
        fix: string;
        at: number;
      };
    }>;
  unrouted: Array<{
      address: string;
      reason: string;
      fix: string;
      at: number;
    }>;
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
    "inboxes": [
      {
        "address": "maya@example.com",
        "how": "imap",
        "kind": "personal",
        "lastReceivedAt": 1760000000000,
        "lastSyncAt": 1760000000000,
        "mailboxId": "mbx_a1b2c3",
        "problem": {
          "at": 1760000000000,
          "fix": "example",
          "reason": "example"
        },
        "receivedToday": 1,
        "state": "ok"
      }
    ],
    "unrouted": [
      {
        "address": "example",
        "at": 1760000000000,
        "fix": "example",
        "reason": "example"
      }
    ]
  }
}
```
