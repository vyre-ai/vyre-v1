# notes.list

The notes the person reads: their own and those shared with them. Pinned first, newest first, with the labels in use

| | |
|---|---|
| Module | notes |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/notes/list |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  label?: string;
  q?: string;
  from?: "all" | "mine" | "shared";
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  notes: Array<{
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
    }>;
  labels: Array<{
      name: string;
      count: number;
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
    "from": "all",
    "label": "Lab 8",
    "limit": 1,
    "q": "example"
  },
  "output": {
    "labels": [
      {
        "count": 1,
        "name": "Lab 8"
      }
    ],
    "next": "example",
    "notes": [
      {
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
    ],
    "total": 1
  }
}
```
