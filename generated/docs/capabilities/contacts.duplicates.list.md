# contacts.duplicates.list

Likely duplicate contacts or companies, with the reasons

| | |
|---|---|
| Module | contacts-link |
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
| HTTP | POST /v1/contacts/duplicates/list |
| MCP tool | contacts_duplicates_list (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type?: "contact" | "company";
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  suggestions: Array<{
      suggestionId: string;
      type: "contact" | "company";
      ids: Array<string>;
      score: number;
      reasons: Array<string>;
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
    "limit": 1,
    "type": "contact"
  },
  "output": {
    "next": "example",
    "suggestions": [
      {
        "ids": [
          "rec_a1b2c3",
          "rec_a1b2c3"
        ],
        "reasons": [
          "example"
        ],
        "score": 1,
        "suggestionId": "example",
        "type": "contact"
      }
    ],
    "total": 1
  }
}
```
