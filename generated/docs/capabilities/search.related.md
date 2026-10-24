# search.related

Items related to one item by links, relations and shared terms

| | |
|---|---|
| Module | search |
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
| HTTP | POST /v1/search/related |
| MCP tool | search_related (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  kind: "person" | "agent" | "chat" | "inbox" | "record" | "file" | "automation" | "app" | "setting" | "memory" | "task" | "channel";
  itemId: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  hits: Array<{
      kind: "person" | "agent" | "chat" | "inbox" | "record" | "file" | "automation" | "app" | "setting" | "memory" | "task" | "channel";
      id: string;
      title: string;
      snippet?: string;
      path?: string;
      link: string;
      label?: "public" | "internal" | "confidential" | "restricted";
      score: number;
      updatedAt?: number;
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
    "itemId": "example",
    "kind": "person",
    "limit": 1
  },
  "output": {
    "hits": [
      {
        "id": "rec_a1b2c3",
        "kind": "person",
        "label": "public",
        "link": "vyre://record/rec_a1b2c3",
        "path": "example",
        "score": 1,
        "snippet": "example",
        "title": "example",
        "updatedAt": 1760000000000
      }
    ]
  }
}
```
