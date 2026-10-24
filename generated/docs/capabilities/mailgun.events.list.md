# mailgun.events.list

List delivery events for a domain, optionally for one message

| | |
|---|---|
| Module | mailgun |
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
| HTTP | POST /v1/mailgun/events/list |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  domain: string;
  providerId?: string;
  event?: "accepted" | "delivered" | "failed" | "opened" | "clicked" | "complained" | "unsubscribed";
  since?: number;
  pageToken?: string;
};
```

## Output

```ts
type Out = {
  events: Array<{
      eventId: string;
      event: "accepted" | "delivered" | "failed" | "opened" | "clicked" | "complained" | "unsubscribed";
      providerId?: string;
      address?: string;
      at: number;
    }>;
  nextPageToken?: string;
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
    "domain": "example",
    "event": "accepted",
    "pageToken": "example",
    "providerId": "example",
    "since": 1760000000000
  },
  "output": {
    "events": [
      {
        "address": "example",
        "at": 1760000000000,
        "event": "accepted",
        "eventId": "example",
        "providerId": "example"
      }
    ],
    "nextPageToken": "example"
  }
}
```
