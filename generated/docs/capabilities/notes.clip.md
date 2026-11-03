# notes.clip

Vyre for Chrome: clip a page into a private note with its address, title, the selected text and a screenshot

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
| HTTP | POST /v1/notes/clip |
| MCP tool | none |
| CLI | none |
| Emits | notes.clipped |

## Input

```ts
type In = {
  url: string;
  title?: string;
  selection?: string;
  note?: string;
  screenshot?: {
    data: string;
    contentType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  };
  labels?: Array<string>;
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
      image?: string;
      description?: string;
    };
    clip?: {
      url: string;
      title?: string;
      selection?: string;
      hasShot: boolean;
      at: number;
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

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "labels": [
      "Lab 8"
    ],
    "note": "example",
    "screenshot": {
      "contentType": "image/png",
      "data": "example"
    },
    "selection": "example",
    "title": "example",
    "url": "example"
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
      "hasImage": true,
      "labels": [
        "Lab 8"
      ],
      "link": {
        "description": "example",
        "image": "example",
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
