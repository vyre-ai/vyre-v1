# notes.create

Take a note: text, an image, or a link that becomes a card. Private to the person until shared

| | |
|---|---|
| Module | notes |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/notes/create |
| MCP tool | notes_create (memory) |
| CLI | none |
| Emits | notes.created |

## Input

```ts
type In = {
  title?: string;
  body?: string;
  color?: "" | "rose" | "sand" | "sage" | "sky" | "lilac" | "slate";
  pinned?: boolean;
  labels?: Array<string>;
  image?: {
    data: string;
    contentType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  };
  link?: string;
  source?: {
    threadId: string;
    messageId: string;
  };
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  note: {
    noteId: string;
    owner: string;
    title: string;
    body: string;
    color: "" | "rose" | "sand" | "sage" | "sky" | "lilac" | "slate";
    pinned: boolean;
    labels: Array<string>;
    hasImage: boolean;
    link?: {
      url: string;
      title?: string;
      siteName?: string;
      description?: string;
      preview?: "image" | "icon";
    };
    clip?: {
      url: string;
      title?: string;
      selection?: string;
      hasShot: boolean;
      at: number;
    };
    from?: {
      threadId?: string;
      messageId?: string;
      title?: string;
      at: number;
      readable: boolean;
    };
    linked: Array<{
        kind: "task" | "record";
        id: string;
        title: string;
        at: number;
      }>;
    share: {
      people: Array<{
          personId: string;
          role: "edit" | "view";
        }>;
      space: "off" | "view" | "edit";
    };
    mine: boolean;
    canEdit: boolean;
    createdAt: number;
    updatedAt: number;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "body": "example",
    "color": "",
    "idempotencyKey": "idem_1",
    "image": {
      "contentType": "image/png",
      "data": "example"
    },
    "labels": [
      "Lab 8"
    ],
    "link": "example",
    "pinned": true,
    "source": {
      "messageId": "msg_a1b2c3",
      "threadId": "thr_a1b2c3"
    },
    "title": "example"
  },
  "output": {
    "note": {
      "body": "example",
      "canEdit": true,
      "clip": {
        "at": 1760000000000,
        "hasShot": true,
        "selection": "example",
        "title": "example",
        "url": "example"
      },
      "color": "",
      "createdAt": 1760000000000,
      "from": {
        "at": 1760000000000,
        "messageId": "msg_a1b2c3",
        "readable": true,
        "threadId": "thr_a1b2c3",
        "title": "example"
      },
      "hasImage": true,
      "labels": [
        "Lab 8"
      ],
      "link": {
        "description": "example",
        "preview": "image",
        "siteName": "example",
        "title": "example",
        "url": "example"
      },
      "linked": [
        {
          "at": 1760000000000,
          "id": "tsk_a1b2c3",
          "kind": "task",
          "title": "example"
        }
      ],
      "mine": true,
      "noteId": "nte_a1b2c3",
      "owner": "usr_a1b2c3",
      "pinned": true,
      "share": {
        "people": [
          {
            "personId": "usr_a1b2c3",
            "role": "edit"
          }
        ],
        "space": "off"
      },
      "title": "example",
      "updatedAt": 1760000000000
    }
  }
}
```
