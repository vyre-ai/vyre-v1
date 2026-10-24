# google.gmail.list_labels

List Gmail labels

| | |
|---|---|
| Module | google |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | connection (/connectionId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/google/gmail/list_labels |
| MCP tool | google_gmail_list_labels (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
};
```

## Output

```ts
type Out = {
  labels: Array<{
      id: string;
      name: string;
      type?: string;
    }>;
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
    "as": "maya@example.com",
    "connectionId": "con_a1b2c3"
  },
  "output": {
    "labels": [
      {
        "id": "example",
        "name": "example",
        "type": "example"
      }
    ]
  }
}
```
