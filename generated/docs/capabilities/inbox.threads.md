# inbox.threads

One contact's email threads, each whole: every thread they are on (From, To or Cc), newest first, with everyone's messages, quoted history and signatures apart, reactions, what is new and your role

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
| HTTP | POST /v1/inbox/threads |
| MCP tool | inbox_threads (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  conversationId?: string;
  contactId?: string;
  images?: boolean;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  conversation: {
    id: string;
    contactId?: string;
    address: string;
    displayName: string;
    lastMessageAt: number;
    lastChannel: "email" | "sms" | "call" | "meeting";
    lastPreview: string;
    unreadCount: number;
    needsMatch: boolean;
    ownerId?: string;
    mailboxIds: Array<string>;
    followed: boolean;
    alertOnReplies: boolean;
    starred?: boolean;
    organisation?: string;
    dnd?: boolean;
    bounced?: boolean;
    unmatched?: boolean;
    draftReady?: boolean;
  };
  threads: Array<{
      threadId: string;
      subject: string;
      role: "started" | "to" | "cc" | "added_later" | "none";
      participants: Array<{
          address: string;
          name?: string;
        }>;
      lastAt: number;
      messageCount: number;
      unread: number;
      messages: Array<{
          unread: boolean;
          message: {
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
          };
        }>;
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
    "contactId": "rec_josh01"
  },
  "output": {
    "conversation": {
      "id": "cnv_josh01",
      "contactId": "rec_josh01",
      "address": "josh@example.com",
      "displayName": "Josh Cohen",
      "lastMessageAt": 1792857600000,
      "lastChannel": "email",
      "lastPreview": "One more: Rachel is out Wednesday afternoon.",
      "unreadCount": 1,
      "needsMatch": false,
      "mailboxIds": [
        "mbx_a1b2c3"
      ],
      "followed": false,
      "alertOnReplies": false
    },
    "threads": [
      {
        "threadId": "18c39f7b2d10",
        "subject": "Welcome to Scout, Josh",
        "role": "cc",
        "participants": [
          {
            "address": "andrey@example.com",
            "name": "Andrey Volkov"
          },
          {
            "address": "josh@example.com",
            "name": "Josh Cohen"
          }
        ],
        "lastAt": 1792857600000,
        "messageCount": 1,
        "unread": 1,
        "messages": [
          {
            "unread": true,
            "message": {
              "id": "eml_a1b2c3",
              "at": 1792857600000,
              "direction": "in",
              "mailboxId": "mbx_a1b2c3",
              "mailboxIds": [
                "mbx_a1b2c3"
              ],
              "from": {
                "address": "josh@example.com",
                "name": "Josh Cohen"
              },
              "to": [
                {
                  "address": "andrey@example.com"
                }
              ],
              "cc": [
                {
                  "address": "irfad@example.com"
                }
              ],
              "subject": "RE: Welcome to Scout, Josh",
              "body": "Thanks Andrey. I am in and the team is set up.",
              "quoted": "From: Andrey Volkov <andrey@example.com>",
              "signature": "Josh Cohen",
              "reactions": [
                {
                  "emoji": "❤️",
                  "from": {
                    "address": "irfad@example.com"
                  },
                  "at": 1792857700000
                }
              ],
              "attachments": [],
              "isPrivate": false
            }
          }
        ]
      }
    ],
    "total": 1
  }
}
```
