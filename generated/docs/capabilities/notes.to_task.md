# notes.to_task

Turn a note into a task. The task holds the note text; the note keeps the task, so each opens the other

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
| HTTP | POST /v1/notes/to_task |
| MCP tool | none |
| CLI | none |
| Emits | notes.linked |

## Input

```ts
type In = {
  noteId: string;
  title?: string;
  assigned?: {
    kind: "person" | "agent";
    id: string;
  };
  due?: number;
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
  taskId: string;
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
    "assigned": {
      "id": "usr_a1b2c3",
      "kind": "person"
    },
    "due": 1760000000000,
    "idempotencyKey": "idem_1",
    "keep": true,
    "noteId": "nte_a1b2c3",
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
    },
    "taskId": "tsk_a1b2c3"
  }
}
```
