# inbox.recipients_search

Ranked recipient search across contacts, members, inboxes and groups (the shared Recipients field)

| | |
|---|---|
| Module | inbox |
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
| HTTP | POST /v1/inbox/recipients_search |
| MCP tool | inbox_recipients_search (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  q: string;
  kinds?: Array<"contact" | "member" | "inbox" | "group">;
  limit?: number;
};
```

## Output

```ts
type Out = {
  results: Array<{
      kind: "contact" | "member" | "inbox" | "group";
      id: string;
      label: string;
      address?: string;
      score: number;
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
    "kinds": [
      "contact"
    ],
    "limit": 1,
    "q": "example"
  },
  "output": {
    "results": [
      {
        "address": "example",
        "id": "example",
        "kind": "contact",
        "label": "example",
        "score": 1
      }
    ]
  }
}
```
