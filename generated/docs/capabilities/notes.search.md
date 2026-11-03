# notes.search

Search the notes the asker may read: title, text, labels, link and clipped page. An agent finds only notes everyone in its chat may read

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
| HTTP | POST /v1/notes/search |
| MCP tool | notes_search (memory) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  q: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  notes: Array<{
      noteId: string;
      title: string;
      snippet: string;
      labels: Array<string>;
      owner: string;
      updatedAt: number;
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
    "limit": 1,
    "q": "example"
  },
  "output": {
    "notes": [
      {
        "labels": [
          "Lab 8"
        ],
        "noteId": "nte_a1b2c3",
        "owner": "usr_a1b2c3",
        "snippet": "example",
        "title": "example",
        "updatedAt": 1760000000000
      }
    ]
  }
}
```
