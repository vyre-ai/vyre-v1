# mail.thread.get

Read one email thread whole: every message you may see, oldest first, with quoted history and signatures apart, Gmail reactions on the message they answer, and your role (you started it, To, Cc, or added later)

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
| HTTP | POST /v1/mail/thread/get |
| MCP tool | mail_thread_get (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  images?: boolean;
};
```

## Output

```ts
type Out = {
  threadId: string;
  subject: string;
  role: "started" | "to" | "cc" | "added_later" | "none";
  participants: Array<{
      address: string;
      name?: string;
    }>;
  messages: Array<{
      id: string;
      at: number;
      direction: "in" | "out";
      mailboxId: string;
      mailboxIds: Array<string>;
      from: {
        address: string;
        name?: string;
      };
      to: Array<{
          address: string;
          name?: string;
        }>;
      cc: Array<{
          address: string;
          name?: string;
        }>;
      subject: string;
      body: string;
      quoted?: string;
      signature?: string;
      html?: string;
      imagesHeld?: number;
      reactions: Array<{
          emoji: string;
          from: {
            address: string;
            name?: string;
          };
          at: number;
        }>;
      attachments: Array<{
          attachmentId: string;
          name: string;
          mime: string;
          size: number;
        }>;
      isPrivate: boolean;
      rfcMessageId?: string;
      inReplyTo?: string;
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
    "images": true,
    "threadId": "18c2a1f04e9b"
  },
  "output": {
    "messages": [
      {
        "at": 1760000000000,
        "attachments": [
          {
            "attachmentId": "example",
            "mime": "example",
            "name": "example",
            "size": 1
          }
        ],
        "body": "example",
        "cc": [
          {
            "address": "maya@example.com",
            "name": "example"
          }
        ],
        "direction": "in",
        "from": {
          "address": "maya@example.com",
          "name": "example"
        },
        "html": "example",
        "id": "eml_a1b2c3",
        "imagesHeld": 1,
        "inReplyTo": "example",
        "isPrivate": true,
        "mailboxId": "mbx_a1b2c3",
        "mailboxIds": [
          "mbx_a1b2c3"
        ],
        "quoted": "example",
        "reactions": [
          {
            "at": 1760000000000,
            "emoji": "❤️",
            "from": {
              "address": "maya@example.com",
              "name": "example"
            }
          }
        ],
        "rfcMessageId": "example",
        "signature": "example",
        "subject": "example",
        "to": [
          {
            "address": "maya@example.com",
            "name": "example"
          }
        ]
      }
    ],
    "participants": [
      {
        "address": "maya@example.com",
        "name": "example"
      }
    ],
    "role": "started",
    "subject": "example",
    "threadId": "example"
  }
}
```
