# search.ask

Ask the Space: answer a question from the chats, records, files, tasks and notes the caller may read, on the caller's own AI account, with numbered citations; nothing readable gives the no-access answer and calls no model

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
| HTTP | POST /v1/search/ask |
| MCP tool | search_ask (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  q: string;
};
```

## Output

```ts
type Out = {
  state: "answered" | "no_access" | "no_account" | "failed";
  answer?: string;
  sources: Array<{
      kind: "person" | "agent" | "chat" | "inbox" | "record" | "file" | "automation" | "app" | "setting" | "memory" | "task" | "channel" | "note";
      id: string;
      title: string;
      recordType?: string;
      snippet?: string;
      path?: string;
      link: string;
      label?: "public" | "internal" | "confidential" | "restricted";
      score: number;
      updatedAt?: number;
      n: number;
      where: string;
    }>;
  cited: Array<number>;
  account?: {
    title: string;
    mine: boolean;
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
    "q": "example"
  },
  "output": {
    "account": {
      "mine": true,
      "title": "example"
    },
    "answer": "example",
    "cited": [
      1
    ],
    "sources": [
      {
        "id": "example",
        "kind": "person",
        "label": "public",
        "link": "vyre://record/rec_a1b2c3",
        "n": 1,
        "path": "example",
        "recordType": "example",
        "score": 1,
        "snippet": "example",
        "title": "example",
        "updatedAt": 1760000000000,
        "where": "File"
      }
    ],
    "state": "answered"
  }
}
```
