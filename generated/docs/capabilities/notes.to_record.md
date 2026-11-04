# notes.to_record

Turn a note into a record of a type, with fields filled from it. The note keeps the record, so each opens the other

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
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/notes/to_record |
| MCP tool | none |
| CLI | none |
| Emits | notes.linked |

## Input

```ts
type In = {
  noteId: string;
  type: string;
  fields: Record<string, unknown>;
  keep?: boolean;
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
  recordId: string;
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
    "fields": {},
    "idempotencyKey": "idem_1",
    "keep": true,
    "noteId": "nte_a1b2c3",
    "type": "contact"
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
    },
    "recordId": "rec_a1b2c3"
  }
}
```
