# search.query

Search everything the caller may see: people, agents, chats, inbox, records, files, automations, apps, settings, memory

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
| HTTP | POST /v1/search/query |
| MCP tool | search_query (meta) |
| CLI | vyre search |
| Emits | none |

## Input

```ts
type In = {
  q: string;
  types?: Array<"person" | "agent" | "chat" | "inbox" | "record" | "file" | "automation" | "app" | "setting" | "memory" | "task" | "channel">;
  mode?: "keyword" | "semantic" | "hybrid";
  folderId?: string;
  recordType?: string;
  cursor?: string;
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
  tookMs: number;
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
    "folderId": "fld_a1b2c3",
    "limit": 1,
    "mode": "keyword",
    "q": "example",
    "recordType": "contact",
    "types": [
      "person"
    ]
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
    ],
    "next": "example",
    "tookMs": 1,
    "total": 1
  }
}
```
