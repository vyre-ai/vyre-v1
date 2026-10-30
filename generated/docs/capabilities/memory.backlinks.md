# memory.backlinks

Where a page is linked from: other pages, chats, runs and records, each with the line that names it; only places the reader can open

| | |
|---|---|
| Module | memory |
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
| HTTP | POST /v1/memory/backlinks |
| MCP tool | memory_backlinks (memory) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  pageId: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  backlinks: Array<{
      kind: "page" | "chat" | "run" | "record";
      ref: string;
      title: string;
      quote: string;
      link?: string;
      at: number;
      label?: string;
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
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "cursor": "example",
    "limit": 1,
    "pageId": "example"
  },
  "output": {
    "backlinks": [
      {
        "at": 1760000000000,
        "kind": "page",
        "label": "example",
        "link": "example",
        "quote": "example",
        "ref": "example",
        "title": "example"
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
