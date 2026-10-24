# google.meet.list_conference_records

List Meet conference records in a time range

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
| HTTP | POST /v1/google/meet/list_conference_records |
| MCP tool | google_meet_list_conference_records (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  from?: string;
  to?: string;
  pageToken?: string;
};
```

## Output

```ts
type Out = {
  records: Array<{
      name: string;
      startTime: string;
      endTime?: string;
      space?: string;
    }>;
  nextPageToken?: string;
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
    "connectionId": "con_a1b2c3",
    "from": "example",
    "pageToken": "example",
    "to": "example"
  },
  "output": {
    "nextPageToken": "example",
    "records": [
      {
        "endTime": "example",
        "name": "example",
        "space": "example",
        "startTime": "example"
      }
    ]
  }
}
```
