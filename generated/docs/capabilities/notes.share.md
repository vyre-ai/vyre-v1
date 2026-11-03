# notes.share

Share a note with people or the Space, change a role, or take it back. Only the owner shares

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
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/notes/share |
| MCP tool | none |
| CLI | none |
| Emits | notes.shared |

## Input

```ts
type In = {
  noteId: string;
  people?: Array<{
      personId: string;
      role: "edit" | "view" | "remove";
    }>;
  space?: "off" | "view" | "edit";
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

## Example

```json
{
  "name": "example",
  "input": {
    "noteId": "nte_a1b2c3",
    "people": [
      {
        "personId": "usr_a1b2c3",
        "role": "edit"
      }
    ],
    "space": "off"
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
